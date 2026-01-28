// Material-specific cutting speed multipliers (base: Steel)
const materialMultipliers = {
    steel: 1.0,
    castIron: 0.7,
    aluminum: 2.5,
    stainlessSteel: 0.6,
    titanium: 0.4,
    brass: 1.8
};

// Tool material multipliers
const toolMaterialMultipliers = {
    hss: 1.0,
    carbide: 2.5,
    coatedCarbide: 3.0,
    ceramic: 4.0,
    diamond: 5.0
};

// Coating multipliers
const coatingMultipliers = {
    none: 1.0,
    tin: 1.3,
    ticn: 1.5,
    alcrn: 1.8,
    diamond: 2.5
};

// Tool comparison storage
let toolComparisons = [];

// Calculate tool life based on ISO 8688-2 principles
function calculateToolLife(params) {
    const {
        workpieceMaterial,
        toolMaterial,
        toolCoating,
        cuttingSpeed,
        feedRate,
        depthOfCut,
        widthOfCut,
        toolDiameter,
        numberOfTeeth
    } = params;

    // Base tool life calculation (Taylor's tool life equation)
    // VT^n = C, where V = cutting speed, T = tool life, n and C are constants
    
    // Material factor
    const materialFactor = materialMultipliers[workpieceMaterial] || 1.0;
    
    // Tool material factor
    const toolFactor = toolMaterialMultipliers[toolMaterial] || 1.0;
    
    // Coating factor
    const coatingFactor = coatingMultipliers[toolCoating] || 1.0;
    
    // Combined factor
    const combinedFactor = materialFactor * toolFactor * coatingFactor;
    
    // Base tool life (minutes) - adjusted for cutting conditions
    // Higher speeds reduce tool life, but better materials/coatings increase it
    const baseToolLife = 60; // Base 60 minutes for standard conditions
    
    // Speed factor (inverse relationship - higher speed = shorter life)
    const speedFactor = Math.pow(100 / cuttingSpeed, 0.2);
    
    // Feed and depth factors (more aggressive = shorter life)
    const feedFactor = Math.pow(0.1 / feedRate, 0.15);
    const depthFactor = Math.pow(2 / depthOfCut, 0.1);
    
    // Calculate tool life
    const toolLife = baseToolLife * combinedFactor * speedFactor * feedFactor * depthFactor;
    
    return Math.max(1, Math.round(toolLife));
}

// Calculate cost per part
function calculateCostPerPart(params) {
    const {
        toolCost,
        toolLife,
        machiningTime,
        machineHourlyRate
    } = params;
    
    // Tool cost per part
    const toolCostPerPart = toolCost / toolLife;
    
    // Machining cost per part
    const machiningCostPerPart = (machiningTime / 60) * machineHourlyRate;
    
    // Total cost per part
    const totalCostPerPart = toolCostPerPart + machiningCostPerPart;
    
    return {
        toolCostPerPart,
        machiningCostPerPart,
        totalCostPerPart
    };
}

// Calculate material removal rate (MRR)
function calculateMRR(params) {
    const {
        toolDiameter,
        feedRate,
        depthOfCut,
        widthOfCut,
        numberOfTeeth,
        cuttingSpeed
    } = params;
    
    // MRR = width × depth × feed rate × number of teeth × RPM
    // RPM = (cutting speed × 1000) / (π × diameter)
    const rpm = (cuttingSpeed * 1000) / (Math.PI * toolDiameter);
    const mrr = widthOfCut * depthOfCut * feedRate * numberOfTeeth * rpm;
    
    return mrr; // mm³/min
}

// Calculate spindle speed
function calculateSpindleSpeed(cuttingSpeed, toolDiameter) {
    return (cuttingSpeed * 1000) / (Math.PI * toolDiameter);
}

// Get recommendations based on calculations
function getRecommendations(params, results) {
    const recommendations = [];
    
    const {
        workpieceMaterial,
        toolMaterial,
        toolCoating,
        cuttingSpeed,
        feedRate,
        depthOfCut
    } = params;
    
    // Tool material recommendations
    if (toolMaterial === 'hss' && (workpieceMaterial === 'stainlessSteel' || workpieceMaterial === 'titanium')) {
        recommendations.push({
            type: 'tool_material',
            message: 'Consider upgrading to carbide or coated carbide tools for better performance with hard materials.'
        });
    }
    
    // Coating recommendations
    if (toolCoating === 'none' && (workpieceMaterial === 'steel' || workpieceMaterial === 'stainlessSteel')) {
        recommendations.push({
            type: 'coating',
            message: 'Adding a TiN or TiCN coating can increase tool life by 30-50% for steel materials.'
        });
    }
    
    // Speed recommendations
    const materialMultiplier = materialMultipliers[workpieceMaterial] || 1.0;
    const recommendedSpeed = 100 * materialMultiplier;
    
    if (Math.abs(cuttingSpeed - recommendedSpeed) > recommendedSpeed * 0.3) {
        recommendations.push({
            type: 'cutting_speed',
            message: `For ${workpieceMaterial}, consider adjusting cutting speed to around ${Math.round(recommendedSpeed)} m/min for optimal tool life.`
        });
    }
    
    // Feed rate recommendations
    if (feedRate < 0.05) {
        recommendations.push({
            type: 'feed_rate',
            message: 'Very low feed rates may cause premature tool wear. Consider increasing feed rate if surface finish allows.'
        });
    } else if (feedRate > 0.3 && toolMaterial === 'hss') {
        recommendations.push({
            type: 'feed_rate',
            message: 'High feed rates with HSS tools may cause rapid wear. Consider reducing feed rate or upgrading to carbide.'
        });
    }
    
    // Cost-effectiveness recommendations
    if (results.toolCostPerPart > results.machiningCostPerPart * 0.3) {
        recommendations.push({
            type: 'cost',
            message: 'Tool cost per part is high relative to machining cost. Consider tools with longer tool life or lower initial cost.'
        });
    }
    
    return recommendations;
}

// Format currency
function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

// Format number with units
function formatNumber(value, unit = '') {
    return `${value.toFixed(2)} ${unit}`.trim();
}

// Get badge class for metrics
function getBadgeClass(value, thresholds) {
    if (value >= thresholds.excellent) return 'badge-excellent';
    if (value >= thresholds.good) return 'badge-good';
    if (value >= thresholds.fair) return 'badge-fair';
    return 'badge-poor';
}

// Display results
function displayResults(params, results) {
    const resultsContainer = document.getElementById('results');
    
    const toolLife = params.toolLife || calculateToolLife(params);
    const mrr = calculateMRR(params);
    const spindleSpeed = calculateSpindleSpeed(params.cuttingSpeed, params.toolDiameter);
    
    const costResults = calculateCostPerPart({
        ...params,
        toolLife
    });
    
    const recommendations = getRecommendations(params, costResults);
    
    let html = `
        <div class="result-item">
            <h3>💰 Cost Analysis</h3>
            <div class="result-label">Total Cost per Part</div>
            <div class="result-value">${formatCurrency(costResults.totalCostPerPart)}</div>
            <div class="result-description">
                Tool cost: ${formatCurrency(costResults.toolCostPerPart)} | 
                Machining cost: ${formatCurrency(costResults.machiningCostPerPart)}
            </div>
        </div>
        
        <div class="result-item">
            <h3>⏱️ Tool Life</h3>
            <div class="result-label">Estimated Tool Life</div>
            <div class="result-value">${toolLife} minutes</div>
            <div class="result-description">
                Based on ISO 8688-2 principles. Tool will produce approximately ${Math.floor(toolLife / params.machiningTime)} parts before replacement.
            </div>
        </div>
        
        <div class="result-item">
            <h3>⚙️ Machining Parameters</h3>
            <div class="result-label">Spindle Speed</div>
            <div class="result-value">${formatNumber(spindleSpeed, 'RPM')}</div>
            <div class="result-label" style="margin-top: 15px;">Material Removal Rate</div>
            <div class="result-value">${formatNumber(mrr, 'mm³/min')}</div>
        </div>
        
        <div class="result-item">
            <h3>📊 Efficiency Metrics</h3>
            <div class="result-label">Cost Efficiency Score</div>
            <div>
                <span class="metric-badge ${getBadgeClass(costResults.totalCostPerPart, {excellent: 1, good: 3, fair: 5})}">
                    ${costResults.totalCostPerPart < 1 ? 'Excellent' : costResults.totalCostPerPart < 3 ? 'Good' : costResults.totalCostPerPart < 5 ? 'Fair' : 'Needs Improvement'}
                </span>
            </div>
            <div class="result-label" style="margin-top: 15px;">Tool Life Score</div>
            <div>
                <span class="metric-badge ${getBadgeClass(toolLife, {excellent: 120, good: 60, fair: 30})}">
                    ${toolLife >= 120 ? 'Excellent' : toolLife >= 60 ? 'Good' : toolLife >= 30 ? 'Fair' : 'Poor'}
                </span>
            </div>
        </div>
    `;
    
    resultsContainer.innerHTML = html;
    
    // Display recommendations
    if (recommendations.length > 0) {
        const recommendationsContainer = document.getElementById('recommendations');
        const recommendationsContent = document.getElementById('recommendationsContent');
        
        let recHtml = '';
        recommendations.forEach(rec => {
            recHtml += `<div class="recommendation-item">${rec.message}</div>`;
        });
        
        recommendationsContent.innerHTML = recHtml;
        recommendationsContainer.style.display = 'block';
    } else {
        document.getElementById('recommendations').style.display = 'none';
    }
}

// Get input values
function getInputValues() {
    return {
        workpieceMaterial: document.getElementById('workpieceMaterial').value,
        toolDiameter: parseFloat(document.getElementById('toolDiameter').value),
        toolMaterial: document.getElementById('toolMaterial').value,
        toolCoating: document.getElementById('toolCoating').value,
        cuttingSpeed: parseFloat(document.getElementById('cuttingSpeed').value),
        feedRate: parseFloat(document.getElementById('feedRate').value),
        depthOfCut: parseFloat(document.getElementById('depthOfCut').value),
        widthOfCut: parseFloat(document.getElementById('widthOfCut').value),
        numberOfTeeth: parseInt(document.getElementById('numberOfTeeth').value),
        toolCost: parseFloat(document.getElementById('toolCost').value),
        machiningTime: parseFloat(document.getElementById('machiningTime').value),
        machineHourlyRate: parseFloat(document.getElementById('machineHourlyRate').value),
        toolLife: document.getElementById('toolLife').value ? parseFloat(document.getElementById('toolLife').value) : null
    };
}

// Add tool to comparison
function addToComparison() {
    const params = getInputValues();
    const toolLife = params.toolLife || calculateToolLife(params);
    const costResults = calculateCostPerPart({ ...params, toolLife });
    const mrr = calculateMRR(params);
    
    const toolData = {
        id: Date.now(),
        name: `Tool ${toolComparisons.length + 1}`,
        ...params,
        toolLife,
        ...costResults,
        mrr
    };
    
    toolComparisons.push(toolData);
    updateComparisonTable();
}

// Update comparison table
function updateComparisonTable() {
    const comparisonSection = document.getElementById('comparisonSection');
    const comparisonResults = document.getElementById('comparisonResults');
    
    if (toolComparisons.length === 0) {
        comparisonSection.style.display = 'none';
        return;
    }
    
    comparisonSection.style.display = 'block';
    
    // Find best values
    const bestTotalCost = Math.min(...toolComparisons.map(t => t.totalCostPerPart));
    const bestToolLife = Math.max(...toolComparisons.map(t => t.toolLife));
    const bestMRR = Math.max(...toolComparisons.map(t => t.mrr));
    
    let html = `
        <table class="comparison-table">
            <thead>
                <tr>
                    <th>Tool</th>
                    <th>Material</th>
                    <th>Coating</th>
                    <th>Cost/Part</th>
                    <th>Tool Life</th>
                    <th>MRR</th>
                    <th>Tool Cost</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    toolComparisons.forEach(tool => {
        html += `
            <tr>
                <td>${tool.name}</td>
                <td>${tool.toolMaterial}</td>
                <td>${tool.toolCoating}</td>
                <td class="${tool.totalCostPerPart === bestTotalCost ? 'best-value' : ''}">
                    ${formatCurrency(tool.totalCostPerPart)}
                </td>
                <td class="${tool.toolLife === bestToolLife ? 'best-value' : ''}">
                    ${tool.toolLife} min
                </td>
                <td class="${tool.mrr === bestMRR ? 'best-value' : ''}">
                    ${formatNumber(tool.mrr, 'mm³/min')}
                </td>
                <td>${formatCurrency(tool.toolCost)}</td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    `;
    
    comparisonResults.innerHTML = html;
}

// Clear comparison
function clearComparison() {
    toolComparisons = [];
    updateComparisonTable();
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('calculateBtn').addEventListener('click', function() {
        const params = getInputValues();
        const toolLife = params.toolLife || calculateToolLife(params);
        const costResults = calculateCostPerPart({ ...params, toolLife });
        displayResults(params, costResults);
    });
    
    document.getElementById('compareBtn').addEventListener('click', function() {
        addToComparison();
    });
    
    document.getElementById('clearComparisonBtn').addEventListener('click', function() {
        clearComparison();
    });
    
    document.getElementById('addToolBtn').addEventListener('click', function() {
        addToComparison();
    });
});
