// State management
const state = {
    activePositions: [1, 2, 3],
    activeView: 'time',
    allData: [],
    teamData: {},
    averages: [],
    teamColors: {},
    activeTeams: new Set()
};

// Animation configuration
const animations = {
    duration: 750,
    easing: d3.easeCubicOut,
    pointDelay: (d, i) => i * 50,
    lineDelay: 200,
    tooltipDuration: 200,
    gridDuration: 500
};

// Configuration
const config = {
    margin: { top: 60, right: 160, bottom: 60, left: 80 }, // Increased right margin for legend
    transitionDuration: 500,
    timeScaleFactor: 1.5, // Factor to increase time scale spacing
    colorScale: chroma.scale(['#2ecc71', '#3498db', '#e74c3c', '#f1c40f'])
        .mode('lch').colors(8)
};


// Initialize visualization
async function init() {
    try {
        const rawData = await d3.csv("bed_race_results.csv");
        
        // Process data
        state.allData = rawData.map(d => ({
            year: +d.Year,
            position: +d.Position,
            teamName: d["Team Name"],
            minutes: +d["Time (Minutes)"],
            seconds: +d["Time (Seconds)"],
            totalSeconds: (+d["Time (Minutes)"]) * 60 + (+d["Time (Seconds)"])
        }));

        // Process team data
        processTeamData();
        
        // Calculate averages
        calculateAverages();
        
        // Assign team colors
        assignTeamColors();
        
        // Initial render
        updateVisualization();
        updateDashboard();
        createTeamLegend();
        
        // Set up event listeners
        setupEventListeners();
        
    } catch (error) {
        console.error("Error initializing:", error);
        showError();
    }
}

function processTeamData() {
    state.teamData = {};
    
    state.allData.forEach(entry => {
        if (!state.teamData[entry.teamName]) {
            state.teamData[entry.teamName] = {
                appearances: 0,
                wins: 0,
                bestTime: Infinity,
                worstTime: 0,
                times: [],
                positions: []
            };
        }
        
        const teamStats = state.teamData[entry.teamName];
        teamStats.appearances++;
        if (entry.position === 1) teamStats.wins++;
        teamStats.bestTime = Math.min(teamStats.bestTime, entry.totalSeconds);
        teamStats.worstTime = Math.max(teamStats.worstTime, entry.totalSeconds);
        teamStats.times.push(entry.totalSeconds);
        teamStats.positions.push(entry.position);
    });
}

function calculateAverages() {
    state.averages = d3.rollups(state.allData,
        v => ({
            totalSeconds: d3.mean(v, d => d.totalSeconds),
            stdDev: d3.deviation(v, d => d.totalSeconds)
        }),
        d => d.year
    ).map(([year, stats]) => ({
        year,
        totalSeconds: stats.totalSeconds,
        stdDev: stats.stdDev,
        position: 'avg'
    }));
}

function assignTeamColors() {
    // First, identify teams that have appeared in top 3
    const topTeams = new Set();
    state.allData
        .filter(d => d.position <= 3)  // Only consider top 3 positions
        .forEach(d => topTeams.add(d.teamName));
    
    // Create a fixed color palette for top teams
    const colorPalette = chroma.scale(['#2ecc71', '#3498db', '#e74c3c', '#f1c40f', '#9b59b6'])
        .mode('lch')
        .colors(topTeams.size);
    
    // Reset team colors
    state.teamColors = {};
    
    // Assign colors only to teams that have reached top 3
    [...topTeams].forEach((team, i) => {
        state.teamColors[team] = colorPalette[i];
    });
}

function updateVisualization() {
    const svg = d3.select("#lineChart")
        .html('')
        .append("svg")
        .attr("viewBox", `0 0 1200 700`)
        .style("background", "linear-gradient(to bottom right, #ffffff, #f8f9fa)")
        .style("border-radius", "12px")
        .style("box-shadow", "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)");

    // Create a group for zoom
    const zoomGroup = svg.append("g")
        .attr("class", "zoom-group");

    const mainGroup = zoomGroup.append("g")
        .attr("transform", `translate(${config.margin.left},${config.margin.top})`);

    const width = 1200 - config.margin.left - config.margin.right;
    const height = 700 - config.margin.top - config.margin.bottom;

    // Calculate y-axis domain based on active view and selections
    let yDomain;
    if (state.activeView === 'time') {
        if (state.activePositions.includes('avg')) {
            const activePositionData = state.allData.filter(d => 
                state.activePositions.includes(d.position)
            );
            const activeTimes = activePositionData.map(d => d.totalSeconds);
            const avgTimes = state.averages.map(d => d.totalSeconds);
            const allValues = [...activeTimes, ...avgTimes];
            const timeExtent = d3.extent(allValues);
            yDomain = [Math.ceil(timeExtent[1]), Math.floor(timeExtent[0])];
        } else {
            const activePositionData = state.allData.filter(d => 
                state.activePositions.includes(d.position)
            );
            const timeExtent = d3.extent(activePositionData, d => d.totalSeconds);
            const timeRange = timeExtent[1] - timeExtent[0];
            yDomain = [
                Math.ceil(timeExtent[1] + (timeRange * 0.1)),
                Math.floor(timeExtent[0] - (timeRange * 0.1))
            ];
        }
    } else {
        const teamsToShow = state.activeTeams.size === 0 
            ? Object.keys(state.teamColors)
            : [...state.activeTeams];
        
        const teamData = state.allData.filter(d => 
            teamsToShow.includes(d.teamName)
        );
        
        const timeExtent = d3.extent(teamData, d => d.totalSeconds);
        const timeRange = timeExtent[1] - timeExtent[0];
        yDomain = [
            Math.ceil(timeExtent[1] + (timeRange * 0.1)),
            Math.floor(timeExtent[0] - (timeRange * 0.1))
        ];
    }

    // Create scales
    const xScale = d3.scaleLinear()
        .domain(d3.extent(state.allData, d => d.year))
        .range([0, width])
        .nice();

    const yScale = d3.scaleLinear()
        .domain(yDomain)
        .range([height, 0])
        .nice();

    // Create zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([1, 10])
        .extent([[0, 0], [width, height]])
        .on("zoom", (event) => {
            const newXScale = event.transform.rescaleX(xScale);
            const newYScale = event.transform.rescaleY(yScale);
            mainGroup.attr("transform", `translate(${config.margin.left + event.transform.x},${config.margin.top + event.transform.y}) scale(${event.transform.k})`);
            updateAxes(mainGroup, newXScale, newYScale, width, height);
            updateGridlines(mainGroup, newXScale, newYScale, width, height);
        });

    // Apply zoom to SVG
    svg.call(zoom)
        .on("dblclick.zoom", null); // Disable double-click zoom

    // Create clip path
    mainGroup.append("defs").append("clipPath")
        .attr("id", "clip")
        .append("rect")
        .attr("width", width)
        .attr("height", height);

    // Create grid and axes
    createGrid(mainGroup, xScale, yScale, width, height);
    createAxes(mainGroup, xScale, yScale, width, height);

    // Draw visualization based on active view
    if (state.activeView === 'time') {
        drawTimeView(mainGroup, xScale, yScale, width, height);
    } else {
        drawTeamView(mainGroup, xScale, yScale, width, height);
    }

    // Create legend
    createSideLegend(mainGroup, width, height);
}



function createCrosshair(svg, width, height) {
    const crosshairGroup = svg.append("g")
        .attr("class", "crosshair")
        .style("display", "none");

    // Vertical line
    crosshairGroup.append("line")
        .attr("class", "crosshair-vertical")
        .attr("y1", 0)
        .attr("y2", height)
        .style("stroke", "#64748b")
        .style("stroke-width", 1)
        .style("stroke-dasharray", "3,3");

    // Horizontal line
    crosshairGroup.append("line")
        .attr("class", "crosshair-horizontal")
        .attr("x1", 0)
        .attr("x2", width)
        .style("stroke", "#64748b")
        .style("stroke-width", 1)
        .style("stroke-dasharray", "3,3");

    return crosshairGroup;
}

function updateCrosshair(crosshairGroup, x, y) {
    crosshairGroup
        .style("display", "block")
        .select(".crosshair-vertical")
        .attr("x1", x)
        .attr("x2", x);

    crosshairGroup
        .select(".crosshair-horizontal")
        .attr("y1", y)
        .attr("y2", y);
}


    function createGrid(svg, xScale, yScale, width, height) {
        // Vertical grid lines (years)
        svg.append("g")
            .attr("class", "grid vertical")
            .selectAll("line")
            .data(xScale.ticks(10))
            .enter()
            .append("line")
            .attr("x1", d => xScale(d))
            .attr("x2", d => xScale(d))
            .attr("y1", 0)
            .attr("y2", height)
            .attr("stroke", "#e0e0e0")
            .attr("stroke-width", 0.5);

        // Horizontal grid lines (times) - more frequent
        svg.append("g")
            .attr("class", "grid horizontal")
            .selectAll("line")
            .data(yScale.ticks(20)) // Increased number of ticks
            .enter()
            .append("line")
            .attr("x1", 0)
            .attr("x2", width)
            .attr("y1", d => yScale(d))
            .attr("y2", d => yScale(d))
            .attr("stroke", "#e0e0e0")
            .attr("stroke-width", 0.5);
    }


    // New side legend creation
    function createSideLegend(svg, width, height) {
        const legendGroup = svg.append("g")
            .attr("class", "legend")
            .attr("transform", `translate(${width + 20}, 0)`); // Position to the right

        // Only show teams that have reached top 3
        const topTeams = Object.entries(state.teamData)
            .filter(([team]) => state.teamColors[team])
            .sort((a, b) => b[1].wins - a[1].wins);

        const legendItems = legendGroup.selectAll(".legend-item")
            .data(topTeams)
            .enter()
            .append("g")
            .attr("class", "legend-item")
            .attr("transform", (d, i) => `translate(0, ${i * 25})`);

        // Legend color boxes
        legendItems.append("rect")
            .attr("width", 12)
            .attr("height", 12)
            .attr("rx", 2)
            .attr("fill", d => state.teamColors[d[0]]);

        // Legend text
        legendItems.append("text")
            .attr("x", 20)
            .attr("y", 10)
            .style("font-size", "12px")
            .text(d => `${d[0]} (${d[1].wins} wins)`);
    }

    // Modified time axis formatter for better readability
    function formatTimeAxis(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }


    function createAxes(svg, xScale, yScale, width, height) {
        const xAxis = d3.axisBottom(xScale)
            .ticks(10)
            .tickFormat(d3.format("d"));
            
        const yAxis = d3.axisLeft(yScale)
            .tickFormat(formatTimeAxis);

        svg.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${height})`)
            .call(xAxis);

        svg.append("g")
            .attr("class", "y-axis")
            .call(yAxis);

        // Add axis labels
        svg.append("text")
            .attr("class", "axis-label")
            .attr("x", width / 2)
            .attr("y", height + 40)
            .style("text-anchor", "middle")
            .text("Year");

        svg.append("text")
            .attr("class", "axis-label")
            .attr("transform", "rotate(-90)")
            .attr("x", -height / 2)
            .attr("y", -60)
            .style("text-anchor", "middle")
            .text("Race Time (MM:SS)");
    }

    function createGrid(svg, xScale, yScale, width, height) {
        svg.append("g")
            .attr("class", "grid")
            .call(d3.axisLeft(yScale)
                .tickSize(-width)
                .tickFormat(""));
    }


    function drawTimeView(svg, xScale, yScale, width, height) {
        const line = d3.line()
            .x(d => xScale(d.year))
            .y(d => yScale(d.totalSeconds))
            .curve(d3.curveMonotoneX);

        // Add hover guidelines group
        const guidelinesGroup = svg.append("g")
            .attr("class", "guidelines")
            .style("opacity", 0);

        // Add horizontal guideline
        const horizontalGuide = guidelinesGroup.append("line")
            .attr("class", "guide horizontal")
            .attr("stroke", "#94a3b8")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "4 4");

        // Add vertical guideline
        const verticalGuide = guidelinesGroup.append("line")
            .attr("class", "guide vertical")
            .attr("stroke", "#94a3b8")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "4 4");

        // Add value labels
        const xLabel = guidelinesGroup.append("text")
            .attr("class", "guide-label x")
            .attr("fill", "#64748b")
            .attr("text-anchor", "middle");

        const yLabel = guidelinesGroup.append("text")
            .attr("class", "guide-label y")
            .attr("fill", "#64748b")
            .attr("text-anchor", "end");

        // Draw position lines with increased thickness
        [1, 2, 3].forEach(pos => {
            if (!state.activePositions.includes(pos)) return;

            const positionData = state.allData.filter(d => d.position === pos);
            console.log (positionData);
            
            
            // Define gradients for each line
            const gradientId = `line-gradient-${pos}`;
            const gradient = svg.append("defs")
                .append("linearGradient")
                .attr("id", gradientId)
                .attr("gradientUnits", "userSpaceOnUse")
                .attr("x1", 0)
                .attr("y1", 0)
                .attr("x2", width)
                .attr("y2", 0);

            const colors = {
                1: ["#ffd700", "#ffed4a"],
                2: ["#c0c0c0", "#e2e8f0"],
                3: ["#cd7f32", "#ed8936"]
            };

            gradient.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", colors[pos][0]);

            gradient.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", colors[pos][1]);

            svg.append("path")
                .datum(positionData)
                .attr("class", `line line-${pos}`)
                .attr("d", line)
                .attr("stroke", `url(#${gradientId})`)
                .attr("stroke-width", 4) // Increased line thickness
                .attr("fill", "none")
                .style("opacity", 0.8)
                .style("filter", "drop-shadow(0 1px 2px rgb(0 0 0 / 0.1))");
        });

        // Draw average line if selected
        if (state.activePositions.includes('avg')) {
            svg.append("path")
                .datum(state.averages)
                .attr("class", "line line-avg")
                .attr("d", line)
                .attr("stroke", "#9b59b6")
                .attr("stroke-width", 3)
                .attr("stroke-dasharray", "6 4")
                .attr("fill", "none")
                .style("opacity", 0.8);
        }

        // Add enhanced data points with hover effects
        state.allData
            .filter(d => state.activePositions.includes(d.position))
            .forEach(d => {
                svg.append("circle")
                    .attr("cx", xScale(d.year))
                    .attr("cy", yScale(d.totalSeconds))
                    .attr("r", 6)
                    .attr("fill", state.teamColors[d.teamName] || "#gray")
                    .attr("stroke", "#fff")
                    .attr("stroke-width", 2)
                    .style("cursor", "pointer")
                    .style("filter", "drop-shadow(0 1px 2px rgb(0 0 0 / 0.1))")
                    .on("mouseover", (event) => {
                        // Show tooltip
                        showTooltip(event, d);
                        
                        // Update and show guidelines
                        horizontalGuide
                            .attr("x1", 0)
                            .attr("y1", yScale(d.totalSeconds))
                            .attr("x2", width)
                            .attr("y2", yScale(d.totalSeconds));

                        verticalGuide
                            .attr("x1", xScale(d.year))
                            .attr("y1", 0)
                            .attr("x2", xScale(d.year))
                            .attr("y2", height);

                        xLabel
                            .attr("x", xScale(d.year))
                            .attr("y", height + 20)
                            .text(d.year);

                        yLabel
                            .attr("x", -10)
                            .attr("y", yScale(d.totalSeconds))
                            .attr("dominant-baseline", "middle")
                            .text(formatTimeAxis(d.totalSeconds));

                        guidelinesGroup.style("opacity", 1);
                    })
                    .on("mouseout", () => {
                        hideTooltip();
                        guidelinesGroup.style("opacity", 0);
                    });
            });
    }

    // Modified drawTeamView function with enhanced styling
    function drawTeamView(svg, xScale, yScale, width, height) {
        const teamLine = d3.line()
            .x(d => xScale(d.year))
            .y(d => yScale(d.totalSeconds))
            .curve(d3.curveMonotoneX);

        // Add hover guidelines group
        const guidelinesGroup = svg.append("g")
            .attr("class", "guidelines")
            .style("opacity", 0);

        // Add horizontal guideline
        const horizontalGuide = guidelinesGroup.append("line")
            .attr("class", "guide horizontal")
            .attr("stroke", "#94a3b8")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "4 4");

        // Add vertical guideline
        const verticalGuide = guidelinesGroup.append("line")
            .attr("class", "guide vertical")
            .attr("stroke", "#94a3b8")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "4 4");

        // Add value labels
        const xLabel = guidelinesGroup.append("text")
            .attr("class", "guide-label x")
            .attr("fill", "#64748b")
            .attr("text-anchor", "middle");

        const yLabel = guidelinesGroup.append("text")
            .attr("class", "guide-label y")
            .attr("fill", "#64748b")
            .attr("text-anchor", "end");

        const teamsToShow = state.activeTeams.size === 0 
            ? Object.keys(state.teamColors)
            : [...state.activeTeams];

        teamsToShow.forEach(teamName => {
            const teamEntries = state.allData
                .filter(d => d.teamName === teamName)
                .sort((a, b) => a.year - b.year);

            if (teamEntries.length > 0) {
                // Create gradient for team line
                const gradientId = `team-gradient-${teamName.replace(/\s+/g, '-')}`;
                const gradient = svg.append("defs")
                    .append("linearGradient")
                    .attr("id", gradientId)
                    .attr("gradientUnits", "userSpaceOnUse")
                    .attr("x1", 0)
                    .attr("y1", 0)
                    .attr("x2", width)
                    .attr("y2", 0);

                const baseColor = state.teamColors[teamName];
                gradient.append("stop")
                    .attr("offset", "0%")
                    .attr("stop-color", baseColor);
                gradient.append("stop")
                    .attr("offset", "100%")
                    .attr("stop-color", d3.color(baseColor).brighter(0.5));

                // Draw the team's line with enhanced styling
                svg.append("path")
                    .datum(teamEntries)
                    .attr("class", "team-line")
                    .attr("d", teamLine)
                    .attr("stroke", `url(#${gradientId})`)
                    .attr("stroke-width", 4)
                    .attr("fill", "none")
                    .style("opacity", 0.8)
                    .style("filter", "drop-shadow(0 1px 2px rgb(0 0 0 / 0.1))");

                // Add enhanced data points
                teamEntries.forEach(entry => {
                    svg.append("circle")
                        .attr("class", "team-point")
                        .attr("cx", xScale(entry.year))
                        .attr("cy", yScale(entry.totalSeconds))
                        .attr("r", 6)
                        .attr("fill", state.teamColors[teamName])
                        .attr("stroke", "#ffffff")
                        .attr("stroke-width", 2)
                        .style("cursor", "pointer")
                        .style("filter", "drop-shadow(0 1px 2px rgb(0 0 0 / 0.1))")
                        .on("mouseover", (event) => {
                            // Show tooltip
                            showTooltip(event, entry);
                            
                            // Update and show guidelines
                            horizontalGuide
                                .attr("x1", 0)
                                .attr("y1", yScale(entry.totalSeconds))
                                .attr("x2", width)
                                .attr("y2", yScale(entry.totalSeconds));

                            verticalGuide
                                .attr("x1", xScale(entry.year))
                                .attr("y1", 0)
                                .attr("x2", xScale(entry.year))
                                .attr("y2", height);

                            xLabel
                                .attr("x", xScale(entry.year))
                                .attr("y", height + 20)
                                .text(entry.year);

                            yLabel
                                .attr("x", -10)
                                .attr("y", yScale(entry.totalSeconds))
                                .attr("dominant-baseline", "middle")
                                .text(formatTimeAxis(entry.totalSeconds));

                            guidelinesGroup.style("opacity", 1);
                        })
                        .on("mouseout", () => {
                            hideTooltip();
                            guidelinesGroup.style("opacity", 0);
                        });
                });
            }
        });
    }
    // Updated tooltip function to handle the new event parameter


    function addAnnotations(svg, xScale, yScale) {
        const bestTime = d3.min(state.allData, d => d.totalSeconds);
        const bestEntry = state.allData.find(d => d.totalSeconds === bestTime);
        
        // Add record annotation
        const recordAnnotation = svg.append("g")
            .attr("class", "annotation")
            .attr("transform", `translate(${xScale(bestEntry.year)},${yScale(bestTime)})`);

        recordAnnotation.append("circle")
            .attr("r", 8)
            .attr("fill", "none")
            .attr("stroke", "#e74c3c")
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "3 3");

        recordAnnotation.append("text")
            .attr("x", 15)
            .attr("y", -10)
            .text("🏆 Course Record")
            .attr("fill", "#e74c3c")
            .attr("font-weight", "bold");
    }

    function showTooltip(event, d) {
        const tooltip = d3.select("#tooltip");
        const [x, y] = d3.pointer(event, document.body);
        
        const teamStats = state.teamData[d.teamName];
        const winRate = ((teamStats.wins / teamStats.appearances) * 100).toFixed(1);
        const teamColor = state.teamColors[d.teamName] || "#gray";
        
        tooltip.style("opacity", 1)
            .style("left", `${x - 320}px`)
            .style("top", `${y - 340}px`)
            .html(`
                <div style="border-left: 3px solid ${teamColor}; padding-left: 8px;">
                    <strong>${d.teamName}</strong><br>
                    Time: ${formatTime(d.minutes, d.seconds)}<br>
                    Position: ${getOrdinal(d.position)}<br>
                    Year: ${d.year}<br>
                    ${teamStats.wins > 0 ? `Win Rate: ${winRate}%<br>` : ''}
                    Appearances: ${teamStats.appearances}
                </div>
            `);
    }

    function hideTooltip() {
        d3.select("#tooltip").style("opacity", 0);
    }

    function createTeamLegend() {
        const legend = d3.select("#teamLegend");
        legend.html(""); // Clear existing legend

        // Get teams that have reached top positions
        const topTeams = Object.entries(state.teamData)
            .filter(([team]) => state.teamColors[team])
            .sort((a, b) => b[1].wins - a[1].wins);

        topTeams.forEach(([teamName, data]) => {
            // Team is active if either no teams are selected (show all) or this team is selected
            const isActive = state.activeTeams.size === 0 || state.activeTeams.has(teamName);

            
            const legendItem = legend.append("div")
            .attr("class", "legend-item")
            .style("cursor", "pointer")
            .style("display", "flex")
            .style("align-items", "center")
            .style("padding", "8px 12px")
            .style("margin", "4px 0")
            .style("border-radius", "8px")
            .style("background", "rgba(255, 255, 255, 0.9)")
            .style("box-shadow", "0 2px 8px rgba(0, 0, 0, 0.1)")
            .style("transition", "all 0.2s ease")
            .style("opacity", isActive ? 1 : 0.4)
            .on("mouseover", function() {
                d3.select(this).style("background", "#f8f9fa");
            })
            .on("mouseout", function() {
                d3.select(this).style("background", "rgba(255, 255, 255, 0.9)");
            })
            .on("click", () => toggleTeam(teamName));
        
        // Color indicator circle
        legendItem.append("span")
            .style("width", "14px")
            .style("height", "14px")
            .style("background-color", state.teamColors[teamName])
            .style("border-radius", "50%")
            .style("display", "inline-block")
            .style("margin-right", "12px")
            .style("box-shadow", "0 2px 4px rgba(0, 0, 0, 0.1)");
        
        // Text label
        legendItem.append("span")
            .style("font-family", "'Segoe UI', sans-serif")
            .style("font-size", "14px")
            .style("font-weight", isActive ? "600" : "400")
            .style("color", isActive ? "#2d3436" : "#adb5bd")
            .style("letter-spacing", "0.25px")
            .text(`${teamName} (${data.wins} wins)`);
        });
    }




function updateDashboard() {
    // Find best performance
    const bestEntry = d3.least(state.allData, d => d.totalSeconds);
    
    // Calculate win statistics
    const winStats = calculateWinStatistics();
    
    // Calculate improvement trend
    const improvementTrend = calculateImprovementTrend();
    
    // Calculate competitiveness index
    const competitiveIndex = calculateCompetitiveIndex();
    
    // Update DOM
    updateDashboardValues(bestEntry, winStats, improvementTrend, competitiveIndex);
}

function calculateWinStatistics() {
    return Object.entries(state.teamData)
        .map(([team, data]) => ({
            team,
            wins: data.wins,
            winRate: (data.wins / data.appearances) * 100
        }))
        .sort((a, b) => b.wins - a.wins)[0];
}

function calculateImprovementTrend() {
    const firstYear = d3.min(state.allData, d => d.year);
    const lastYear = d3.max(state.allData, d => d.year);
    
    const firstYearAvg = d3.mean(
        state.allData.filter(d => d.year === firstYear),
        d => d.totalSeconds
    );
    
    const lastYearAvg = d3.mean(
        state.allData.filter(d => d.year === lastYear),
        d => d.totalSeconds
    );
    
    return ((firstYearAvg - lastYearAvg) / firstYearAvg) * 100;
}

function calculateCompetitiveIndex() {
    return d3.mean(state.averages, d => d.stdDev) / 60; // Convert to minutes for readability
}

function updateDashboardValues(bestEntry, winStats, improvementTrend, competitiveIndex) {
    // Update best time stats
    d3.select("#bestTime").text(formatTime(bestEntry.minutes, bestEntry.seconds));
    d3.select("#bestTeam").text(bestEntry.teamName);
    d3.select("#bestYear").text(bestEntry.year);

    // Update championship stats
    d3.select("#totalWins").text(winStats.wins);
    d3.select("#topTeam").text(winStats.team);
    d3.select("#winRate").text(`${winStats.winRate.toFixed(1)}%`);

    // Update improvement trend
    d3.select("#avgImprovement")
        .text(`${improvementTrend.toFixed(1)}%`)
        .style("color", improvementTrend > 0 ? "#2ecc71" : "#e74c3c");

    // Update competitiveness index
    d3.select("#competitiveness")
        .text(competitiveIndex.toFixed(2));
}

// Utility Functions
function formatTime(minutes, seconds) {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatTimeAxis(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getOrdinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Event Handlers
function setupEventListeners() {
    // Position filter buttons
    d3.selectAll(".filter-btn").on("click", function() {
        const btn = d3.select(this);
        const pos = btn.attr("data-position") === "avg" ? "avg" : +btn.attr("data-position");
        
        if (pos === "avg") {
            state.activePositions = state.activePositions.includes("avg") ?
                state.activePositions.filter(p => p !== "avg") :
                [...state.activePositions, "avg"];
        } else {
            state.activePositions = state.activePositions.includes(pos) ?
                state.activePositions.filter(p => p !== pos) :
                [...state.activePositions, pos];
        }
        
        btn.classed("active", state.activePositions.includes(pos));
        updateVisualization();
    });

    // View toggle buttons
    d3.selectAll(".view-btn").on("click", function() {
        const view = d3.select(this).attr("data-view");
        state.activeView = view;
        
        d3.selectAll(".view-btn").classed("active", false);
        d3.select(this).classed("active", true);
        
        updateVisualization();
        createTeamLegend();
    });
}


function toggleTeam(teamName) {
    if (state.activeTeams.has(teamName)) {
        state.activeTeams.delete(teamName);
        // If we just removed the last team, clear the set to show all
        if (state.activeTeams.size === 0) {
            state.activeTeams = new Set();
        }
    } else {
        state.activeTeams.add(teamName);
    }
    
    // Update visualization only if we're in team view
    if (state.activeView === 'team') {
        updateVisualization();
    }
    createTeamLegend();
}



function showError() {
    d3.select("#lineChart")
        .append("div")
        .attr("class", "error-message")
        .html(`
            <div class="error-container">
                <h3>⚠️ Data Loading Error</h3>
                <p>Please check:</p>
                <ul>
                    <li>Data file existence and format</li>
                    <li>Server configuration</li>
                    <li>Network connectivity</li>
                </ul>
                <button onclick="init()">Retry</button>
            </div>
        `);
}

// Initialize application
document.addEventListener('DOMContentLoaded', init);

// Window resize handler
window.addEventListener('resize', debounce(() => {
    updateVisualization();
}, 250));

// Utility function for debouncing
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}



