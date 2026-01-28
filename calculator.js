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

// Chart instances
let toolLifeChartInstance = null;
let costSavingsChartInstance = null;
let comparisonToolLifeChartInstance = null;
let comparisonCostChartInstance = null;
let comparisonEfficiencyChartInstance = null;

// Photo and crop instances
let cropperInstance = null;
let currentToolPhoto = null;
let currentPhotoDate = null;

// Catalogue import
let importedCatalogueData = null;
let fieldMapping = {};
let mappedToolData = [];

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
        toolRemainingCost = 0,
        toolLife,
        processingTime,
        machiningTime,
        toolChangeCost = 0,
        toolChangeTime = 0,
        machineHourlyRate,
        batchSize = 1
    } = params;
    
    // Net tool cost (initial cost minus remaining/residual value)
    const netToolCost = toolCost - toolRemainingCost;
    
    // Tool cost per part
    const toolCostPerPart = netToolCost / toolLife;
    
    // Calculate number of tool changes needed for tool life
    // Assuming tool changes happen periodically during tool life
    const timePerPart = machiningTime !== null && machiningTime !== undefined ? machiningTime : (processingTime + toolChangeTime);
    const partsPerToolLife = Math.floor(toolLife / timePerPart);
    const toolChangesPerToolLife = Math.max(0, partsPerToolLife - 1);
    const toolChangeCostPerToolLife = toolChangesPerToolLife * toolChangeCost;
    const toolChangeCostPerPart = partsPerToolLife > 0 ? (toolChangeCostPerToolLife / partsPerToolLife) : 0;
    
    // Processing cost per part (cutting time only)
    const processingCostPerPart = (processingTime / 60) * machineHourlyRate;
    
    // Tool change time cost per part
    const toolChangeTimeCostPerPart = (toolChangeTime / 60) * machineHourlyRate;
    
    // Total machining cost per part (if machiningTime is provided, use it; otherwise calculate from processing + tool change time)
    const totalMachiningTime = machiningTime !== null && machiningTime !== undefined ? machiningTime : (processingTime + toolChangeTime);
    const machiningCostPerPart = (totalMachiningTime / 60) * machineHourlyRate;
    
    // Total cost per part
    const totalCostPerPart = toolCostPerPart + toolChangeCostPerPart + machiningCostPerPart;
    
    // Batch calculations
    const totalBatchCost = totalCostPerPart * batchSize;
    const totalToolCostForBatch = (netToolCost / toolLife) * batchSize;
    const totalMachiningCostForBatch = machiningCostPerPart * batchSize;
    
    return {
        toolCostPerPart,
        toolChangeCostPerPart,
        processingCostPerPart,
        toolChangeTimeCostPerPart,
        machiningCostPerPart,
        totalCostPerPart,
        totalBatchCost,
        totalToolCostForBatch,
        totalMachiningCostForBatch,
        partsPerToolLife,
        toolChangesPerToolLife
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

// Calculate feed per revolution
function calculateFeedPerRevolution(feedPerTooth, numberOfTeeth) {
    return feedPerTooth * numberOfTeeth;
}

// Calculate feed rate (mm/min)
function calculateFeedRate(feedPerTooth, numberOfTeeth, spindleSpeed) {
    return feedPerTooth * numberOfTeeth * spindleSpeed;
}

// Calculate chip thickness (approximate)
function calculateChipThickness(feedPerTooth, depthOfCut, toolDiameter) {
    // Simplified chip thickness calculation
    const engagementAngle = Math.acos(1 - (2 * depthOfCut) / toolDiameter);
    return feedPerTooth * Math.sin(engagementAngle);
}

// Calculate specific cutting force (N/mm²)
function calculateSpecificCuttingForce(workpieceMaterial, materialHardness = 30) {
    // Base specific cutting force values (N/mm²) for different materials
    const baseForces = {
        steel: 2000,
        castIron: 1500,
        aluminum: 800,
        stainlessSteel: 2500,
        titanium: 3000,
        brass: 1200
    };
    
    const baseForce = baseForces[workpieceMaterial] || 2000;
    
    // Adjust for hardness (harder materials require more force)
    const hardnessFactor = 1 + (materialHardness - 30) / 100;
    
    return baseForce * hardnessFactor;
}

// Calculate cutting force (N)
function calculateCuttingForce(specificCuttingForce, depthOfCut, widthOfCut, feedPerTooth) {
    return specificCuttingForce * depthOfCut * widthOfCut * feedPerTooth;
}

// Calculate power requirement (kW)
function calculatePowerRequirement(cuttingForce, cuttingSpeed) {
    // P = F × V / 60000 (where F in N, V in m/min, result in kW)
    return (cuttingForce * cuttingSpeed) / 60000;
}

// Calculate torque (Nm)
function calculateTorque(power, spindleSpeed) {
    // T = P × 9550 / n (where P in kW, n in RPM, result in Nm)
    if (spindleSpeed === 0) return 0;
    return (power * 9550) / spindleSpeed;
}

// Calculate surface finish (Ra in μm) - approximate
function calculateSurfaceFinish(feedPerTooth, toolDiameter, numberOfTeeth) {
    // Simplified surface finish calculation
    // Ra ≈ f² / (8 × R) where f is feed per tooth, R is tool radius
    const toolRadius = toolDiameter / 2;
    const ra = Math.pow(feedPerTooth, 2) / (8 * toolRadius);
    return Math.max(0.1, ra * 1000); // Convert to micrometers
}

// Calculate Taylor's tool life constant C
function calculateTaylorConstant(cuttingSpeed, toolLife, taylorExponent = 0.2) {
    // C = V × T^n
    return cuttingSpeed * Math.pow(toolLife, taylorExponent);
}

// Calculate metal removal rate per unit power (cm³/min/kW)
function calculateMRRPerPower(mrr, power) {
    if (power === 0) return 0;
    return (mrr / 1000) / power; // Convert mm³ to cm³
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
    
    // Tool change recommendations
    if (params.toolChangeCost > 0 && results.toolChangeCostPerPart > results.toolCostPerPart * 0.5) {
        recommendations.push({
            type: 'tool_change',
            message: 'Tool change costs are significant. Consider optimizing tool change frequency or reducing tool change time.'
        });
    }
    
    // Processing time recommendations
    if (params.processingTime && params.machiningTime && params.processingTime < params.machiningTime * 0.7) {
        recommendations.push({
            type: 'processing_time',
            message: 'Tool change time represents a significant portion of total machining time. Consider faster tool change systems or tool optimization.'
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
    const feedPerRev = calculateFeedPerRevolution(params.feedRate, params.numberOfTeeth);
    const feedRateMM = calculateFeedRate(params.feedRate, params.numberOfTeeth, spindleSpeed);
    const chipThickness = calculateChipThickness(params.feedRate, params.depthOfCut, params.toolDiameter);
    const materialHardness = params.materialHardness || 30;
    const specificCuttingForce = calculateSpecificCuttingForce(params.workpieceMaterial, materialHardness);
    const cuttingForce = calculateCuttingForce(specificCuttingForce, params.depthOfCut, params.widthOfCut, params.feedRate);
    const powerRequired = calculatePowerRequirement(cuttingForce, params.cuttingSpeed);
    const torque = calculateTorque(powerRequired, spindleSpeed);
    const surfaceFinish = calculateSurfaceFinish(params.feedRate, params.toolDiameter, params.numberOfTeeth);
    const taylorConstant = calculateTaylorConstant(params.cuttingSpeed, toolLife);
    const mrrPerPower = calculateMRRPerPower(mrr, powerRequired);
    
    const costResults = calculateCostPerPart({
        ...params,
        toolLife
    });
    
    const recommendations = getRecommendations(params, costResults);
    
    // Display project information if available
    let projectInfoHtml = '';
    if (params.clientName || params.projectName || params.partName || params.machineName || params.toolBrand || params.toolNameModel) {
        projectInfoHtml = `
            <div class="result-item" style="background: #f0f9ff; border-left-color: #0ea5e9;">
                <h3>📋 Project Information</h3>
                ${params.clientName ? `<div class="result-label">Client: <strong>${params.clientName}</strong></div>` : ''}
                ${params.projectName ? `<div class="result-label">Project: <strong>${params.projectName}</strong></div>` : ''}
                ${params.partName ? `<div class="result-label">Part/Detail: <strong>${params.partName}</strong></div>` : ''}
                ${params.machineName ? `<div class="result-label">Machine: <strong>${params.machineName}</strong></div>` : ''}
                ${params.applicationType ? `<div class="result-label">Application: <strong>${params.applicationType}</strong></div>` : ''}
                ${params.customerContact ? `<div class="result-label">Contact: <strong>${params.customerContact}</strong></div>` : ''}
                ${params.batchSize > 1 ? `<div class="result-label">Batch Size: <strong>${params.batchSize} parts</strong></div>` : ''}
            </div>
            ${params.toolBrand || params.toolNameModel || params.toolProductCode ? `
            <div class="result-item" style="background: #fef3c7; border-left-color: #f59e0b;">
                <h3>🔧 Tool Information</h3>
                ${params.toolBrand ? `<div class="result-label">Brand: <strong>${params.toolBrand.charAt(0).toUpperCase() + params.toolBrand.slice(1)}</strong></div>` : ''}
                ${params.toolType ? `<div class="result-label">Type: <strong>${params.toolType.replace(/([A-Z])/g, ' $1').trim()}</strong></div>` : ''}
                ${params.toolNameModel ? `<div class="result-label">Name/Model: <strong>${params.toolNameModel}</strong></div>` : ''}
                ${params.toolProductCode ? `<div class="result-label">Product Code: <strong>${params.toolProductCode}</strong></div>` : ''}
                ${params.toolPhoto ? `
                <div class="result-label" style="margin-top: 10px;">Tool Photo:</div>
                <img src="${params.toolPhoto}" alt="Tool Photo" class="tool-photo-display" style="max-width: 200px; max-height: 200px; border-radius: 8px; border: 2px solid var(--border-color); margin-top: 5px;">
                ` : ''}
                ${params.photoDate ? `
                <div class="result-label" style="margin-top: 10px;">Photo Date: <strong>${formatDate(params.photoDate)}</strong></div>
                ` : ''}
            </div>
            ` : ''}
        `;
    }
    
    let html = projectInfoHtml + `
        <div class="result-item">
            <h3>💰 Cost Analysis</h3>
            <div class="result-label">Total Cost per Part</div>
            <div class="result-value">${formatCurrency(costResults.totalCostPerPart)}</div>
            <div class="result-description">
                <strong>Breakdown:</strong><br>
                • Tool cost: ${formatCurrency(costResults.toolCostPerPart)}<br>
                ${costResults.toolChangeCostPerPart > 0 ? `• Tool change cost: ${formatCurrency(costResults.toolChangeCostPerPart)}<br>` : ''}
                • Machining cost: ${formatCurrency(costResults.machiningCostPerPart)}<br>
                ${costResults.processingCostPerPart ? `• Processing (cutting) cost: ${formatCurrency(costResults.processingCostPerPart)}<br>` : ''}
            </div>
            ${params.batchSize > 1 ? `
                <div class="result-label" style="margin-top: 15px;">Total Batch Cost (${params.batchSize} parts)</div>
                <div class="result-value">${formatCurrency(costResults.totalBatchCost)}</div>
                <div class="result-description">
                    Tool cost for batch: ${formatCurrency(costResults.totalToolCostForBatch)} | 
                    Machining cost for batch: ${formatCurrency(costResults.totalMachiningCostForBatch)}
                </div>
            ` : ''}
        </div>
        
        <div class="result-item">
            <h3>⏱️ Tool Life</h3>
            <div class="result-label">Estimated Tool Life</div>
            <div class="result-value">${toolLife} minutes</div>
            <div class="result-description">
                Based on ISO 8688-2 principles. Tool will produce approximately ${costResults.partsPerToolLife} parts before replacement.
                ${costResults.toolChangesPerToolLife > 0 ? `<br>Expected tool changes during tool life: ${costResults.toolChangesPerToolLife}` : ''}
            </div>
        </div>
        
        <div class="result-item">
            <h3>⚙️ Machining Parameters</h3>
            <div class="result-label">Spindle Speed, n</div>
            <div class="result-value">${formatNumber(spindleSpeed, 'RPM')}</div>
            <div class="result-description">n = (V<sub>c</sub> × 1000) / (π × D)</div>
            
            <div class="result-label" style="margin-top: 15px;">Feed Rate, V<sub>f</sub></div>
            <div class="result-value">${formatNumber(feedRateMM, 'mm/min')}</div>
            <div class="result-description">V<sub>f</sub> = f<sub>z</sub> × Z × n</div>
            
            <div class="result-label" style="margin-top: 15px;">Feed per Revolution, f</div>
            <div class="result-value">${formatNumber(feedPerRev, 'mm/rev')}</div>
            <div class="result-description">f = f<sub>z</sub> × Z</div>
            
            <div class="result-label" style="margin-top: 15px;">Material Removal Rate, Q</div>
            <div class="result-value">${formatNumber(mrr, 'mm³/min')}</div>
            <div class="result-description">Q = a<sub>e</sub> × a<sub>p</sub> × V<sub>f</sub></div>
        </div>
        
        <div class="result-item">
            <h3>🔬 Cutting Forces & Power</h3>
            <div class="result-label">Specific Cutting Force, k<sub>c</sub></div>
            <div class="result-value">${formatNumber(specificCuttingForce, 'N/mm²')}</div>
            <div class="result-description">Material-dependent cutting force per unit area</div>
            
            <div class="result-label" style="margin-top: 15px;">Cutting Force, F<sub>c</sub></div>
            <div class="result-value">${formatNumber(cuttingForce, 'N')}</div>
            <div class="result-description">F<sub>c</sub> = k<sub>c</sub> × a<sub>p</sub> × a<sub>e</sub> × f<sub>z</sub></div>
            
            <div class="result-label" style="margin-top: 15px;">Power Requirement, P</div>
            <div class="result-value">${formatNumber(powerRequired, 'kW')}</div>
            <div class="result-description">P = F<sub>c</sub> × V<sub>c</sub> / 60000</div>
            
            <div class="result-label" style="margin-top: 15px;">Torque, M</div>
            <div class="result-value">${formatNumber(torque, 'Nm')}</div>
            <div class="result-description">M = P × 9550 / n</div>
            
            <div class="result-label" style="margin-top: 15px;">MRR per Power</div>
            <div class="result-value">${formatNumber(mrrPerPower, 'cm³/min/kW')}</div>
            <div class="result-description">Efficiency metric: Q / P</div>
        </div>
        
        <div class="result-item">
            <h3>📏 Chip Geometry & Surface Quality</h3>
            <div class="result-label">Chip Thickness, h</div>
            <div class="result-value">${formatNumber(chipThickness, 'mm')}</div>
            <div class="result-description">Approximate undeformed chip thickness</div>
            
            <div class="result-label" style="margin-top: 15px;">Surface Roughness, R<sub>a</sub></div>
            <div class="result-value">${formatNumber(surfaceFinish, 'μm')}</div>
            <div class="result-description">Estimated arithmetic average roughness</div>
            
            ${params.helixAngle ? `
            <div class="result-label" style="margin-top: 15px;">Helix Angle, β</div>
            <div class="result-value">${params.helixAngle}°</div>
            ` : ''}
            
            ${params.rakeAngle ? `
            <div class="result-label" style="margin-top: 15px;">Rake Angle, γ</div>
            <div class="result-value">${params.rakeAngle}°</div>
            ` : ''}
        </div>
        
        <div class="result-item">
            <h3>📐 Taylor's Tool Life Equation</h3>
            <div class="result-label">Tool Life Constant, C</div>
            <div class="result-value">${formatNumber(taylorConstant, '')}</div>
            <div class="result-description">V<sub>c</sub> × T<sup>n</sup> = C (n ≈ 0.2)</div>
            
            <div class="result-label" style="margin-top: 15px;">Taylor Exponent, n</div>
            <div class="result-value">0.2</div>
            <div class="result-description">Standard value for end milling (ISO 8688-2)</div>
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
    
    // Display technical specifications
    displayTechnicalSpecs(params, {
        spindleSpeed,
        feedRateMM,
        feedPerRev,
        mrr,
        cuttingForce,
        powerRequired,
        torque,
        surfaceFinish,
        toolLife,
        taylorConstant
    });
    
    // Display engineering formulas
    displayEngineeringFormulas();
    
    // Display tool life visualization
    displayToolLifeChart(params, toolLife, costResults);
    
    // Display cost savings chart
    displayCostSavingsChart(params, costResults);
    
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

// Display technical specifications
function displayTechnicalSpecs(params, techData) {
    const specsContainer = document.getElementById('technicalSpecs');
    const specsContent = document.getElementById('technicalSpecsContent');
    
    let html = `
        <table class="technical-table">
            <tr>
                <th>Parameter</th>
                <th>Symbol</th>
                <th>Value</th>
                <th>Unit</th>
            </tr>
            ${params.toolBrand ? `
            <tr>
                <td>Tool Brand</td>
                <td>-</td>
                <td>${params.toolBrand.charAt(0).toUpperCase() + params.toolBrand.slice(1)}</td>
                <td>-</td>
            </tr>
            ` : ''}
            ${params.toolType ? `
            <tr>
                <td>Tool Type</td>
                <td>-</td>
                <td>${params.toolType.replace(/([A-Z])/g, ' $1').trim()}</td>
                <td>-</td>
            </tr>
            ` : ''}
            ${params.toolNameModel ? `
            <tr>
                <td>Tool Model</td>
                <td>-</td>
                <td>${params.toolNameModel}</td>
                <td>-</td>
            </tr>
            ` : ''}
            ${params.toolProductCode ? `
            <tr>
                <td>Product Code</td>
                <td>-</td>
                <td>${params.toolProductCode}</td>
                <td>-</td>
            </tr>
            ` : ''}
            ${params.photoDate ? `
            <tr>
                <td>Photo Date</td>
                <td>-</td>
                <td>${formatDate(params.photoDate)}</td>
                <td>-</td>
            </tr>
            ` : ''}
            <tr>
                <td>Tool Diameter</td>
                <td>D</td>
                <td>${params.toolDiameter}</td>
                <td>mm</td>
            </tr>
            <tr>
                <td>Number of Teeth</td>
                <td>Z</td>
                <td>${params.numberOfTeeth}</td>
                <td>-</td>
            </tr>
            <tr>
                <td>Cutting Speed</td>
                <td>V<sub>c</sub></td>
                <td>${params.cuttingSpeed}</td>
                <td>m/min</td>
            </tr>
            <tr>
                <td>Feed per Tooth</td>
                <td>f<sub>z</sub></td>
                <td>${params.feedRate}</td>
                <td>mm/tooth</td>
            </tr>
            <tr>
                <td>Axial Depth of Cut</td>
                <td>a<sub>p</sub></td>
                <td>${params.depthOfCut}</td>
                <td>mm</td>
            </tr>
            <tr>
                <td>Radial Width of Cut</td>
                <td>a<sub>e</sub></td>
                <td>${params.widthOfCut}</td>
                <td>mm</td>
            </tr>
            <tr>
                <td>Spindle Speed</td>
                <td>n</td>
                <td>${formatNumber(techData.spindleSpeed, '')}</td>
                <td>RPM</td>
            </tr>
            <tr>
                <td>Feed Rate</td>
                <td>V<sub>f</sub></td>
                <td>${formatNumber(techData.feedRateMM, '')}</td>
                <td>mm/min</td>
            </tr>
            <tr>
                <td>Material Removal Rate</td>
                <td>Q</td>
                <td>${formatNumber(techData.mrr, '')}</td>
                <td>mm³/min</td>
            </tr>
            <tr>
                <td>Cutting Force</td>
                <td>F<sub>c</sub></td>
                <td>${formatNumber(techData.cuttingForce, '')}</td>
                <td>N</td>
            </tr>
            <tr>
                <td>Power Requirement</td>
                <td>P</td>
                <td>${formatNumber(techData.powerRequired, '')}</td>
                <td>kW</td>
            </tr>
            <tr>
                <td>Torque</td>
                <td>M</td>
                <td>${formatNumber(techData.torque, '')}</td>
                <td>Nm</td>
            </tr>
            <tr>
                <td>Tool Life</td>
                <td>T</td>
                <td>${techData.toolLife}</td>
                <td>min</td>
            </tr>
        </table>
    `;
    
    specsContent.innerHTML = html;
    specsContainer.style.display = 'block';
}

// Display engineering formulas
function displayEngineeringFormulas() {
    const formulasContainer = document.getElementById('engineeringFormulas');
    const formulasContent = document.getElementById('engineeringFormulasContent');
    
    let html = `
        <div class="formula-section">
            <h4>Spindle Speed</h4>
            <div class="formula">n = (V<sub>c</sub> × 1000) / (π × D)</div>
            <div class="formula-desc">Where: n = RPM, V<sub>c</sub> = cutting speed (m/min), D = tool diameter (mm)</div>
        </div>
        
        <div class="formula-section">
            <h4>Feed Rate</h4>
            <div class="formula">V<sub>f</sub> = f<sub>z</sub> × Z × n</div>
            <div class="formula-desc">Where: V<sub>f</sub> = feed rate (mm/min), f<sub>z</sub> = feed per tooth (mm/tooth), Z = number of teeth</div>
        </div>
        
        <div class="formula-section">
            <h4>Material Removal Rate</h4>
            <div class="formula">Q = a<sub>e</sub> × a<sub>p</sub> × V<sub>f</sub></div>
            <div class="formula-desc">Where: Q = MRR (mm³/min), a<sub>e</sub> = radial width (mm), a<sub>p</sub> = axial depth (mm)</div>
        </div>
        
        <div class="formula-section">
            <h4>Cutting Force</h4>
            <div class="formula">F<sub>c</sub> = k<sub>c</sub> × a<sub>p</sub> × a<sub>e</sub> × f<sub>z</sub></div>
            <div class="formula-desc">Where: F<sub>c</sub> = cutting force (N), k<sub>c</sub> = specific cutting force (N/mm²)</div>
        </div>
        
        <div class="formula-section">
            <h4>Power Requirement</h4>
            <div class="formula">P = F<sub>c</sub> × V<sub>c</sub> / 60000</div>
            <div class="formula-desc">Where: P = power (kW), F<sub>c</sub> = cutting force (N), V<sub>c</sub> = cutting speed (m/min)</div>
        </div>
        
        <div class="formula-section">
            <h4>Torque</h4>
            <div class="formula">M = P × 9550 / n</div>
            <div class="formula-desc">Where: M = torque (Nm), P = power (kW), n = spindle speed (RPM)</div>
        </div>
        
        <div class="formula-section">
            <h4>Taylor's Tool Life Equation (ISO 8688-2)</h4>
            <div class="formula">V<sub>c</sub> × T<sup>n</sup> = C</div>
            <div class="formula-desc">Where: V<sub>c</sub> = cutting speed (m/min), T = tool life (min), n = Taylor exponent (≈0.2), C = constant</div>
        </div>
    `;
    
    formulasContent.innerHTML = html;
    formulasContainer.style.display = 'block';
}

// Get input values
function getInputValues() {
    return {
        // Client & Project Information
        clientName: document.getElementById('clientName').value.trim(),
        projectName: document.getElementById('projectName').value.trim(),
        customerContact: document.getElementById('customerContact').value.trim(),
        machineName: document.getElementById('machineName').value.trim(),
        partName: document.getElementById('partName').value.trim(),
        applicationType: document.getElementById('applicationType').value,
        batchSize: parseInt(document.getElementById('batchSize').value) || 1,
        
        // Tool Selection
        toolBrand: document.getElementById('toolBrand').value,
        toolType: document.getElementById('toolType').value,
        toolNameModel: document.getElementById('toolNameModel').value.trim(),
        toolProductCode: document.getElementById('toolProductCode').value.trim(),
        toolPhoto: currentToolPhoto,
        photoDate: currentPhotoDate,
        
        // Tool & Material Parameters
        workpieceMaterial: document.getElementById('workpieceMaterial').value,
        toolDiameter: parseFloat(document.getElementById('toolDiameter').value),
        toolMaterial: document.getElementById('toolMaterial').value,
        toolCoating: document.getElementById('toolCoating').value,
        cuttingSpeed: parseFloat(document.getElementById('cuttingSpeed').value),
        feedRate: parseFloat(document.getElementById('feedRate').value),
        depthOfCut: parseFloat(document.getElementById('depthOfCut').value),
        widthOfCut: parseFloat(document.getElementById('widthOfCut').value),
        numberOfTeeth: parseInt(document.getElementById('numberOfTeeth').value),
        helixAngle: document.getElementById('helixAngle') ? parseFloat(document.getElementById('helixAngle').value) : null,
        rakeAngle: document.getElementById('rakeAngle') ? parseFloat(document.getElementById('rakeAngle').value) : null,
        materialHardness: document.getElementById('materialHardness') ? parseFloat(document.getElementById('materialHardness').value) : 30,
        
        // Cost & Time Parameters
        toolCost: parseFloat(document.getElementById('toolCost').value),
        toolRemainingCost: parseFloat(document.getElementById('toolRemainingCost').value) || 0,
        processingTime: parseFloat(document.getElementById('processingTime').value),
        toolChangeCost: parseFloat(document.getElementById('toolChangeCost').value) || 0,
        toolChangeTime: parseFloat(document.getElementById('toolChangeTime').value) || 0,
        machiningTime: document.getElementById('machiningTime').value ? parseFloat(document.getElementById('machiningTime').value) : null,
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
    
    // Create descriptive tool name
    let toolName = `Tool ${toolComparisons.length + 1}`;
    if (params.toolNameModel) {
        toolName = params.toolNameModel;
        if (params.toolBrand) {
            toolName = `${params.toolBrand.charAt(0).toUpperCase() + params.toolBrand.slice(1)} ${toolName}`;
        }
    } else if (params.toolBrand) {
        toolName = `${params.toolBrand.charAt(0).toUpperCase() + params.toolBrand.slice(1)} ${toolName}`;
    } else if (params.partName) {
        toolName = `${params.partName} - ${toolName}`;
    } else if (params.applicationType) {
        toolName = `${params.applicationType} - ${toolName}`;
    }
    
    const toolData = {
        id: Date.now(),
        name: toolName,
        ...params,
        toolLife,
        ...costResults,
        mrr,
        toolPhoto: params.toolPhoto,
        photoDate: params.photoDate
    };
    
    toolComparisons.push(toolData);
    updateComparisonTable();
}

// Display tool life chart
function displayToolLifeChart(params, toolLife, costResults) {
    const chartContainer = document.getElementById('toolLifeChart');
    const chartCanvas = document.getElementById('toolLifeChartCanvas');
    
    if (!chartCanvas) return;
    
    chartContainer.style.display = 'block';
    
    // Destroy existing chart if it exists
    if (toolLifeChartInstance) {
        toolLifeChartInstance.destroy();
    }
    
    // Calculate parts produced over time
    const timePerPart = params.machiningTime !== null && params.machiningTime !== undefined 
        ? params.machiningTime 
        : (params.processingTime + (params.toolChangeTime || 0));
    
    const partsProduced = Math.floor(toolLife / timePerPart);
    const timePoints = [];
    const partsPoints = [];
    const costPoints = [];
    
    // Generate data points
    for (let i = 0; i <= Math.min(partsProduced, 20); i++) {
        const time = i * timePerPart;
        if (time <= toolLife) {
            timePoints.push(time);
            partsPoints.push(i);
            costPoints.push(costResults.totalCostPerPart * i);
        }
    }
    
    toolLifeChartInstance = new Chart(chartCanvas, {
        type: 'line',
        data: {
            labels: timePoints.map(t => `${t.toFixed(1)} min`),
            datasets: [{
                label: 'Parts Produced',
                data: partsPoints,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                tension: 0.4,
                fill: true,
                yAxisID: 'y'
            }, {
                label: 'Cumulative Cost (€)',
                data: costPoints,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true,
                yAxisID: 'y1'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Tool Life vs Parts Produced & Cost Over Time'
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Parts Produced'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Cumulative Cost (€)'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Time (minutes)'
                    }
                }
            }
        }
    });
}

// Display cost savings chart
function displayCostSavingsChart(params, costResults) {
    const chartContainer = document.getElementById('costSavingsChart');
    const chartCanvas = document.getElementById('costSavingsChartCanvas');
    
    if (!chartCanvas) return;
    
    chartContainer.style.display = 'block';
    
    // Destroy existing chart if it exists
    if (costSavingsChartInstance) {
        costSavingsChartInstance.destroy();
    }
    
    // Cost breakdown pie chart
    const costBreakdown = [
        costResults.toolCostPerPart,
        costResults.machiningCostPerPart,
        costResults.toolChangeCostPerPart || 0
    ].filter(c => c > 0);
    
    const labels = [
        'Tool Cost',
        'Machining Cost',
        'Tool Change Cost'
    ].slice(0, costBreakdown.length);
    
    costSavingsChartInstance = new Chart(chartCanvas, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: costBreakdown,
                backgroundColor: [
                    'rgba(37, 99, 235, 0.8)',
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(245, 158, 11, 0.8)'
                ],
                borderColor: [
                    '#2563eb',
                    '#10b981',
                    '#f59e0b'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Cost Breakdown per Part'
                },
                legend: {
                    display: true,
                    position: 'right'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = formatCurrency(context.parsed);
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((context.parsed / total) * 100).toFixed(1);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
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
    
    // Calculate savings
    calculateAndDisplaySavings();
    
    // Display comparison charts
    displayComparisonCharts();
    
    let html = `
        <table class="comparison-table">
            <thead>
                <tr>
                    <th>Tool</th>
                    <th>Brand</th>
                    <th>Type</th>
                    <th>Part</th>
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
                <td>${tool.toolBrand ? tool.toolBrand.charAt(0).toUpperCase() + tool.toolBrand.slice(1) : 'N/A'}</td>
                <td>${tool.toolType ? tool.toolType.replace(/([A-Z])/g, ' $1').trim() : 'N/A'}</td>
                <td>${tool.partName || 'N/A'}</td>
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

// Calculate and display savings
function calculateAndDisplaySavings() {
    if (toolComparisons.length < 2) {
        document.getElementById('savingsSummary').style.display = 'none';
        return;
    }
    
    const savingsContainer = document.getElementById('savingsSummary');
    const savingsContent = document.getElementById('savingsSummaryContent');
    
    // Find best and worst tools
    const sortedByCost = [...toolComparisons].sort((a, b) => a.totalCostPerPart - b.totalCostPerPart);
    const bestTool = sortedByCost[0];
    const worstTool = sortedByCost[sortedByCost.length - 1];
    
    const costDifference = worstTool.totalCostPerPart - bestTool.totalCostPerPart;
    const costSavingsPercent = ((costDifference / worstTool.totalCostPerPart) * 100).toFixed(1);
    
    // Calculate batch savings
    const batchSize = toolComparisons[0].batchSize || 1;
    const savingsPerPart = costDifference;
    const savingsPerBatch = savingsPerPart * batchSize;
    const savingsPer100Parts = savingsPerPart * 100;
    
    let html = `
        <div class="savings-item best-tool">
            <div class="savings-label">Best Tool (Lowest Cost)</div>
            <div class="savings-value">${bestTool.name || 'Tool 1'}</div>
            <div class="savings-cost">${formatCurrency(bestTool.totalCostPerPart)} per part</div>
        </div>
        
        <div class="savings-item worst-tool">
            <div class="savings-label">Most Expensive Tool</div>
            <div class="savings-value">${worstTool.name || 'Tool 2'}</div>
            <div class="savings-cost">${formatCurrency(worstTool.totalCostPerPart)} per part</div>
        </div>
        
        <div class="savings-item savings-highlight">
            <div class="savings-label">💰 Potential Savings</div>
            <div class="savings-value-large">${formatCurrency(savingsPerPart)}</div>
            <div class="savings-details">
                <div>Per Part: ${formatCurrency(savingsPerPart)} (${costSavingsPercent}% reduction)</div>
                ${batchSize > 1 ? `<div>Per Batch (${batchSize} parts): ${formatCurrency(savingsPerBatch)}</div>` : ''}
                <div>Per 100 Parts: ${formatCurrency(savingsPer100Parts)}</div>
            </div>
        </div>
    `;
    
    // Calculate annual savings estimate (assuming production volume)
    if (batchSize > 1) {
        const annualPartsEstimate = batchSize * 50; // Rough estimate: 50 batches/year
        const annualSavings = savingsPerPart * annualPartsEstimate;
        html += `
            <div class="savings-item annual-savings">
                <div class="savings-label">📅 Estimated Annual Savings</div>
                <div class="savings-value-large">${formatCurrency(annualSavings)}</div>
                <div class="savings-details">Based on ${annualPartsEstimate} parts/year</div>
            </div>
        `;
    }
    
    savingsContent.innerHTML = html;
    savingsContainer.style.display = 'block';
}

// Display comparison charts
function displayComparisonCharts() {
    if (toolComparisons.length < 2) {
        document.getElementById('comparisonCharts').style.display = 'none';
        return;
    }
    
    const chartsContainer = document.getElementById('comparisonCharts');
    chartsContainer.style.display = 'block';
    
    // Tool Life Comparison Chart
    const toolLifeCanvas = document.getElementById('comparisonToolLifeChart');
    if (toolLifeCanvas && comparisonToolLifeChartInstance) {
        comparisonToolLifeChartInstance.destroy();
    }
    
    if (toolLifeCanvas) {
        comparisonToolLifeChartInstance = new Chart(toolLifeCanvas, {
            type: 'bar',
            data: {
                labels: toolComparisons.map(t => t.name || 'Tool'),
                datasets: [{
                    label: 'Tool Life (minutes)',
                    data: toolComparisons.map(t => t.toolLife),
                    backgroundColor: toolComparisons.map((t, i) => {
                        const maxLife = Math.max(...toolComparisons.map(t => t.toolLife));
                        return t.toolLife === maxLife ? 'rgba(16, 185, 129, 0.8)' : 'rgba(37, 99, 235, 0.8)';
                    }),
                    borderColor: toolComparisons.map((t, i) => {
                        const maxLife = Math.max(...toolComparisons.map(t => t.toolLife));
                        return t.toolLife === maxLife ? '#10b981' : '#2563eb';
                    }),
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'Tool Life Comparison'
                    },
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Tool Life (minutes)'
                        }
                    }
                }
            }
        });
    }
    
    // Cost Comparison Chart
    const costCanvas = document.getElementById('comparisonCostChart');
    if (costCanvas && comparisonCostChartInstance) {
        comparisonCostChartInstance.destroy();
    }
    
    if (costCanvas) {
        comparisonCostChartInstance = new Chart(costCanvas, {
            type: 'bar',
            data: {
                labels: toolComparisons.map(t => t.name || 'Tool'),
                datasets: [{
                    label: 'Cost per Part (€)',
                    data: toolComparisons.map(t => t.totalCostPerPart),
                    backgroundColor: toolComparisons.map((t, i) => {
                        const minCost = Math.min(...toolComparisons.map(t => t.totalCostPerPart));
                        return t.totalCostPerPart === minCost ? 'rgba(16, 185, 129, 0.8)' : 'rgba(239, 68, 68, 0.8)';
                    }),
                    borderColor: toolComparisons.map((t, i) => {
                        const minCost = Math.min(...toolComparisons.map(t => t.totalCostPerPart));
                        return t.totalCostPerPart === minCost ? '#10b981' : '#ef4444';
                    }),
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'Cost per Part Comparison'
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `Cost: ${formatCurrency(context.parsed.y)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Cost per Part (€)'
                        }
                    }
                }
            }
        });
    }
    
    // Efficiency Metrics Chart
    const efficiencyCanvas = document.getElementById('comparisonEfficiencyChart');
    if (efficiencyCanvas && comparisonEfficiencyChartInstance) {
        comparisonEfficiencyChartInstance.destroy();
    }
    
    if (efficiencyCanvas) {
        // Normalize MRR values for comparison
        const maxMRR = Math.max(...toolComparisons.map(t => t.mrr));
        const normalizedMRR = toolComparisons.map(t => (t.mrr / maxMRR) * 100);
        
        comparisonEfficiencyChartInstance = new Chart(efficiencyCanvas, {
            type: 'radar',
            data: {
                labels: toolComparisons.map(t => t.name || 'Tool'),
                datasets: toolComparisons.map((tool, index) => ({
                    label: tool.name || `Tool ${index + 1}`,
                    data: [
                        (tool.toolLife / Math.max(...toolComparisons.map(t => t.toolLife))) * 100,
                        (1 - (tool.totalCostPerPart / Math.max(...toolComparisons.map(t => t.totalCostPerPart)))) * 100,
                        (tool.mrr / maxMRR) * 100
                    ],
                    backgroundColor: `rgba(${37 + index * 30}, ${99 + index * 20}, ${235 - index * 30}, 0.2)`,
                    borderColor: `rgba(${37 + index * 30}, ${99 + index * 20}, ${235 - index * 30}, 1)`,
                    borderWidth: 2
                }))
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'Efficiency Comparison (Normalized)'
                    },
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            stepSize: 20
                        }
                    }
                }
            }
        });
    }
}

// Clear comparison
function clearComparison() {
    // Destroy chart instances
    if (comparisonToolLifeChartInstance) {
        comparisonToolLifeChartInstance.destroy();
        comparisonToolLifeChartInstance = null;
    }
    if (comparisonCostChartInstance) {
        comparisonCostChartInstance.destroy();
        comparisonCostChartInstance = null;
    }
    if (comparisonEfficiencyChartInstance) {
        comparisonEfficiencyChartInstance.destroy();
        comparisonEfficiencyChartInstance = null;
    }
    
    toolComparisons = [];
    updateComparisonTable();
}

// Photo upload and crop functions
function initializePhotoUpload() {
    const fileInput = document.getElementById('toolPhoto');
    const uploadBtn = document.getElementById('uploadPhotoBtn');
    const photoPreviewContainer = document.getElementById('photoPreviewContainer');
    const photoPreviewImg = document.getElementById('photoPreviewImg');
    const cropModal = document.getElementById('cropModal');
    const cropImage = document.getElementById('cropImage');
    const cropContainer = document.getElementById('cropContainer');
    
    // Upload button click
    uploadBtn.addEventListener('click', function() {
        fileInput.click();
    });
    
    // File input change
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            handlePhotoUpload(file);
        }
    });
    
    // Remove photo
    document.getElementById('removePhotoBtn').addEventListener('click', function() {
        currentToolPhoto = null;
        currentPhotoDate = null;
        fileInput.value = '';
        photoPreviewContainer.style.display = 'none';
    });
    
    // Crop photo button
    document.getElementById('cropPhotoBtn').addEventListener('click', function() {
        if (currentToolPhoto) {
            openCropModal();
        }
    });
    
    // Close crop modal
    document.getElementById('closeCropModal').addEventListener('click', closeCropModal);
    document.getElementById('cancelCropBtn').addEventListener('click', closeCropModal);
    
    // Apply crop
    document.getElementById('applyCropBtn').addEventListener('click', function() {
        if (cropperInstance) {
            const canvas = cropperInstance.getCroppedCanvas({
                width: 800,
                height: 800,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high'
            });
            
            canvas.toBlob(function(blob) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    currentToolPhoto = e.target.result;
                    photoPreviewImg.src = currentToolPhoto;
                    closeCropModal();
                };
                reader.readAsDataURL(blob);
            }, 'image/jpeg', 0.9);
        }
    });
    
    // Close modal on outside click
    cropModal.addEventListener('click', function(e) {
        if (e.target === cropModal) {
            closeCropModal();
        }
    });
}

function handlePhotoUpload(file) {
    const reader = new FileReader();
    const photoPreviewContainer = document.getElementById('photoPreviewContainer');
    const photoPreviewImg = document.getElementById('photoPreviewImg');
    const photoDateInfo = document.getElementById('photoDateInfo');
    
    reader.onload = function(e) {
        currentToolPhoto = e.target.result;
        photoPreviewImg.src = currentToolPhoto;
        photoPreviewContainer.style.display = 'block';
        
        // Extract EXIF data for date
        EXIF.getData(file, function() {
            const dateTimeOriginal = EXIF.getTag(this, 'DateTimeOriginal');
            const dateTime = EXIF.getTag(this, 'DateTime');
            const dateTimeDigitized = EXIF.getTag(this, 'DateTimeDigitized');
            
            let photoDate = null;
            let dateSource = '';
            
            if (dateTimeOriginal) {
                photoDate = parseEXIFDate(dateTimeOriginal);
                dateSource = 'EXIF DateTimeOriginal';
            } else if (dateTime) {
                photoDate = parseEXIFDate(dateTime);
                dateSource = 'EXIF DateTime';
            } else if (dateTimeDigitized) {
                photoDate = parseEXIFDate(dateTimeDigitized);
                dateSource = 'EXIF DateTimeDigitized';
            } else {
                // Use file modification date
                photoDate = new Date(file.lastModified);
                dateSource = 'File Modified Date';
            }
            
            if (photoDate) {
                currentPhotoDate = photoDate;
                const formattedDate = formatDate(photoDate);
                photoDateInfo.innerHTML = `
                    <strong>📅 Photo Date:</strong> ${formattedDate}<br>
                    <small style="color: var(--text-secondary);">Source: ${dateSource}</small>
                `;
            } else {
                photoDateInfo.innerHTML = '<small style="color: var(--text-secondary);">Date information not available</small>';
            }
        });
    };
    
    reader.readAsDataURL(file);
}

function parseEXIFDate(exifDateString) {
    // EXIF date format: "YYYY:MM:DD HH:MM:SS"
    const parts = exifDateString.split(' ');
    if (parts.length === 2) {
        const datePart = parts[0].replace(/:/g, '-');
        const timePart = parts[1];
        return new Date(datePart + 'T' + timePart);
    }
    return null;
}

function formatDate(date) {
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(date);
}

function openCropModal() {
    const cropModal = document.getElementById('cropModal');
    const cropImage = document.getElementById('cropImage');
    
    cropImage.src = currentToolPhoto;
    cropModal.style.display = 'block';
    
    // Initialize cropper after image loads
    cropImage.onload = function() {
        if (cropperInstance) {
            cropperInstance.destroy();
        }
        
        cropperInstance = new Cropper(cropImage, {
            aspectRatio: 1,
            viewMode: 1,
            dragMode: 'move',
            autoCropArea: 0.8,
            restore: false,
            guides: true,
            center: true,
            highlight: false,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
            responsive: true,
            minCropBoxWidth: 100,
            minCropBoxHeight: 100
        });
    };
}

function closeCropModal() {
    const cropModal = document.getElementById('cropModal');
    cropModal.style.display = 'none';
    
    if (cropperInstance) {
        cropperInstance.destroy();
        cropperInstance = null;
    }
}

// Catalogue import functions
function initializeCatalogueImport() {
    const fileInput = document.getElementById('catalogueFile');
    const importBtn = document.getElementById('importCatalogueBtn');
    const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
    const importModal = document.getElementById('catalogueImportModal');
    const closeImportBtn = document.getElementById('closeImportModal');
    const cancelImportBtn = document.getElementById('cancelImportBtn');
    const applyMappingBtn = document.getElementById('applyMappingBtn');
    const importSelectedBtn = document.getElementById('importSelectedBtn');
    
    // Import button click
    importBtn.addEventListener('click', function() {
        fileInput.click();
    });
    
    // Download template
    downloadTemplateBtn.addEventListener('click', function() {
        downloadCatalogueTemplate();
    });
    
    // File input change
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            handleCatalogueImport(file);
        }
    });
    
    // Close modal
    closeImportBtn.addEventListener('click', closeImportModal);
    cancelImportBtn.addEventListener('click', closeImportModal);
    importModal.addEventListener('click', function(e) {
        if (e.target === importModal) {
            closeImportModal();
        }
    });
    
    // Apply mapping
    applyMappingBtn.addEventListener('click', function() {
        applyFieldMapping();
    });
    
    // Import selected tools
    importSelectedBtn.addEventListener('click', function() {
        importSelectedTools();
    });
}

function downloadCatalogueTemplate() {
    const template = {
        brand: 'kennametal',
        type: 'endMill',
        nameModel: 'KOR5',
        productCode: 'KOR5-1000-12-4FL',
        diameter: 10,
        material: 'carbide',
        coating: 'tin',
        numberOfTeeth: 4,
        helixAngle: 30,
        rakeAngle: 5,
        toolCost: 50,
        cuttingSpeed: 100,
        feedRate: 0.1,
        depthOfCut: 2,
        widthOfCut: 5
    };
    
    const csv = Papa.unparse([template]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'tool_catalogue_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function handleCatalogueImport(file) {
    const fileName = file.name.toLowerCase();
    const importModal = document.getElementById('catalogueImportModal');
    const importStatus = document.getElementById('importStatus');
    
    importModal.style.display = 'block';
    importStatus.innerHTML = '<p style="color: var(--primary-color);">Processing catalogue file...</p>';
    
    if (fileName.endsWith('.csv')) {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                handleParsedData(results.data, results.meta.fields);
            },
            error: function(error) {
                importStatus.innerHTML = `<p style="color: var(--danger-color);">Error parsing CSV: ${error.message}</p>`;
            }
        });
    } else if (fileName.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                const fields = Array.isArray(data) && data.length > 0 ? Object.keys(data[0]) : [];
                handleParsedData(data, fields);
            } catch (error) {
                importStatus.innerHTML = `<p style="color: var(--danger-color);">Error parsing JSON: ${error.message}</p>`;
            }
        };
        reader.readAsText(file);
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                const fields = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
                handleParsedData(jsonData, fields);
            } catch (error) {
                importStatus.innerHTML = `<p style="color: var(--danger-color);">Error parsing Excel: ${error.message}</p>`;
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        importStatus.innerHTML = '<p style="color: var(--danger-color);">Unsupported file format. Please use CSV, JSON, or Excel files.</p>';
    }
}

function handleParsedData(data, fields) {
    if (!data || data.length === 0) {
        document.getElementById('importStatus').innerHTML = '<p style="color: var(--danger-color);">No data found in file.</p>';
        return;
    }
    
    importedCatalogueData = data;
    
    // Auto-detect field mapping
    autoDetectFieldMapping(fields);
    
    // Show mapping interface
    displayFieldMapping(fields);
    
    // Apply mapping and show preview
    applyFieldMapping();
}

function autoDetectFieldMapping(catalogueFields) {
    const fieldAliases = {
        brand: ['brand', 'manufacturer', 'maker', 'company'],
        type: ['type', 'tooltype', 'category', 'tool_type'],
        nameModel: ['name', 'model', 'namemodel', 'name_model', 'modelname', 'model_name', 'partnumber', 'part_number'],
        productCode: ['code', 'productcode', 'product_code', 'sku', 'partcode', 'part_code'],
        diameter: ['diameter', 'd', 'dia', 'size', 'toolsize', 'tool_size'],
        material: ['material', 'toolmaterial', 'tool_material', 'grade'],
        coating: ['coating', 'coated', 'surface'],
        numberOfTeeth: ['teeth', 'flutes', 'numberofteeth', 'number_of_teeth', 'z'],
        helixAngle: ['helix', 'helixangle', 'helix_angle', 'beta'],
        rakeAngle: ['rake', 'rakeangle', 'rake_angle', 'gamma'],
        toolCost: ['cost', 'price', 'toolcost', 'tool_cost'],
        cuttingSpeed: ['speed', 'cutting speed', 'cutting_speed', 'vc', 'v_c'],
        feedRate: ['feed', 'feedrate', 'feed_rate', 'fz', 'f_z'],
        depthOfCut: ['depth', 'depthofcut', 'depth_of_cut', 'ap', 'a_p'],
        widthOfCut: ['width', 'widthofcut', 'width_of_cut', 'ae', 'a_e', 'stepover']
    };
    
    fieldMapping = {};
    
    catalogueFields.forEach(catField => {
        const lowerField = catField.toLowerCase().trim();
        
        for (const [calcField, aliases] of Object.entries(fieldAliases)) {
            if (aliases.some(alias => lowerField.includes(alias) || alias.includes(lowerField))) {
                fieldMapping[calcField] = catField;
                break;
            }
        }
    });
}

function displayFieldMapping(catalogueFields) {
    const mappingContainer = document.getElementById('fieldMappingContainer');
    const mappingSection = document.getElementById('importMappingSection');
    
    const calculatorFields = [
        { key: 'brand', label: 'Brand', required: false },
        { key: 'type', label: 'Type', required: false },
        { key: 'nameModel', label: 'Name/Model', required: false },
        { key: 'productCode', label: 'Product Code', required: false },
        { key: 'diameter', label: 'Diameter', required: true },
        { key: 'material', label: 'Tool Material', required: false },
        { key: 'coating', label: 'Coating', required: false },
        { key: 'numberOfTeeth', label: 'Number of Teeth', required: false },
        { key: 'helixAngle', label: 'Helix Angle', required: false },
        { key: 'rakeAngle', label: 'Rake Angle', required: false },
        { key: 'toolCost', label: 'Tool Cost', required: false },
        { key: 'cuttingSpeed', label: 'Cutting Speed', required: false },
        { key: 'feedRate', label: 'Feed Rate', required: false },
        { key: 'depthOfCut', label: 'Depth of Cut', required: false },
        { key: 'widthOfCut', label: 'Width of Cut', required: false }
    ];
    
    let html = '<table class="technical-table" style="font-size: 0.9rem;"><thead><tr><th>Calculator Field</th><th>Catalogue Column</th></tr></thead><tbody>';
    
    calculatorFields.forEach(field => {
        const mappedValue = fieldMapping[field.key] || '';
        html += `
            <tr>
                <td>
                    ${field.label}
                    ${field.required ? '<span style="color: var(--danger-color);">*</span>' : ''}
                </td>
                <td>
                    <select class="field-mapping-select" data-field="${field.key}" style="width: 100%; padding: 5px;">
                        <option value="">-- Select Column --</option>
                        ${catalogueFields.map(catField => 
                            `<option value="${catField}" ${mappedValue === catField ? 'selected' : ''}>${catField}</option>`
                        ).join('')}
                    </select>
                </td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    
    mappingContainer.innerHTML = html;
    mappingSection.style.display = 'block';
    
    // Update mapping on change
    mappingContainer.querySelectorAll('.field-mapping-select').forEach(select => {
        select.addEventListener('change', function() {
            fieldMapping[this.dataset.field] = this.value;
        });
    });
}

function applyFieldMapping() {
    if (!importedCatalogueData || importedCatalogueData.length === 0) {
        return;
    }
    
    mappedToolData = importedCatalogueData.map((row, index) => {
        const mapped = {
            _index: index,
            _selected: true
        };
        
        // Map each field
        Object.keys(fieldMapping).forEach(calcField => {
            const catField = fieldMapping[calcField];
            if (catField && row[catField] !== undefined && row[catField] !== null && row[catField] !== '') {
                let value = row[catField];
                
                // Convert numeric fields
                const numericFields = ['diameter', 'numberOfTeeth', 'helixAngle', 'rakeAngle', 'toolCost', 
                                     'cuttingSpeed', 'feedRate', 'depthOfCut', 'widthOfCut'];
                if (numericFields.includes(calcField)) {
                    value = parseFloat(value);
                    if (isNaN(value)) value = null;
                }
                
                // Normalize string values
                if (typeof value === 'string') {
                    value = value.trim();
                    // Normalize brand names
                    if (calcField === 'brand') {
                        value = value.toLowerCase().replace(/\s+/g, '');
                    }
                    // Normalize tool types
                    if (calcField === 'type') {
                        value = value.toLowerCase().replace(/\s+/g, '');
                    }
                }
                
                mapped[calcField] = value;
            }
        });
        
        return mapped;
    });
    
    displayImportPreview();
    document.getElementById('applyMappingBtn').style.display = 'none';
    document.getElementById('importSelectedBtn').style.display = 'block';
}

function displayImportPreview() {
    const previewContainer = document.getElementById('importPreviewContainer');
    const previewSection = document.getElementById('importPreviewSection');
    
    if (mappedToolData.length === 0) {
        previewContainer.innerHTML = '<p style="color: var(--text-secondary);">No tools to preview.</p>';
        return;
    }
    
    let html = `
        <div style="margin-bottom: 10px;">
            <label style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" id="selectAllTools" checked style="width: auto;">
                <strong>Select All (${mappedToolData.length} tools)</strong>
            </label>
        </div>
        <table class="technical-table" style="font-size: 0.85rem;">
            <thead>
                <tr>
                    <th style="width: 40px;">
                        <input type="checkbox" id="selectAllCheckbox" checked>
                    </th>
                    <th>Brand</th>
                    <th>Model</th>
                    <th>Diameter</th>
                    <th>Type</th>
                    <th>Cost</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    mappedToolData.forEach((tool, index) => {
        html += `
            <tr>
                <td>
                    <input type="checkbox" class="tool-select-checkbox" data-index="${index}" ${tool._selected ? 'checked' : ''}>
                </td>
                <td>${tool.brand || 'N/A'}</td>
                <td>${tool.nameModel || tool.productCode || 'N/A'}</td>
                <td>${tool.diameter ? tool.diameter + ' mm' : 'N/A'}</td>
                <td>${tool.type || 'N/A'}</td>
                <td>${tool.toolCost ? formatCurrency(tool.toolCost) : 'N/A'}</td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    
    previewContainer.innerHTML = html;
    previewSection.style.display = 'block';
    
    // Select all functionality
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const selectAllTools = document.getElementById('selectAllTools');
    const toolCheckboxes = previewContainer.querySelectorAll('.tool-select-checkbox');
    
    function updateSelectAll() {
        const allSelected = Array.from(toolCheckboxes).every(cb => cb.checked);
        selectAllCheckbox.checked = allSelected;
        selectAllTools.checked = allSelected;
    }
    
    selectAllCheckbox.addEventListener('change', function() {
        toolCheckboxes.forEach(cb => {
            cb.checked = this.checked;
            mappedToolData[parseInt(cb.dataset.index)]._selected = this.checked;
        });
        selectAllTools.checked = this.checked;
    });
    
    selectAllTools.addEventListener('change', function() {
        toolCheckboxes.forEach(cb => {
            cb.checked = this.checked;
            mappedToolData[parseInt(cb.dataset.index)]._selected = this.checked;
        });
        selectAllCheckbox.checked = this.checked;
    });
    
    toolCheckboxes.forEach(cb => {
        cb.addEventListener('change', function() {
            mappedToolData[parseInt(this.dataset.index)]._selected = this.checked;
            updateSelectAll();
        });
    });
}

function importSelectedTools() {
    const selectedTools = mappedToolData.filter(tool => tool._selected);
    
    if (selectedTools.length === 0) {
        alert('Please select at least one tool to import.');
        return;
    }
    
    // Import first tool into form (most common use case)
    if (selectedTools.length > 0) {
        const firstTool = selectedTools[0];
        populateToolForm(firstTool);
        
        if (selectedTools.length > 1) {
            // Add remaining tools to comparison
            selectedTools.slice(1).forEach(tool => {
                addToolToComparison(tool);
            });
            alert(`Imported ${selectedTools.length} tools. First tool loaded into form, ${selectedTools.length - 1} added to comparison.`);
        } else {
            alert('Tool imported successfully!');
        }
    }
    
    closeImportModal();
}

function populateToolForm(tool) {
    if (tool.brand) document.getElementById('toolBrand').value = tool.brand;
    if (tool.type) document.getElementById('toolType').value = tool.type;
    if (tool.nameModel) document.getElementById('toolNameModel').value = tool.nameModel;
    if (tool.productCode) document.getElementById('toolProductCode').value = tool.productCode;
    if (tool.diameter) document.getElementById('toolDiameter').value = tool.diameter;
    if (tool.material) document.getElementById('toolMaterial').value = tool.material;
    if (tool.coating) document.getElementById('toolCoating').value = tool.coating;
    if (tool.numberOfTeeth) document.getElementById('numberOfTeeth').value = tool.numberOfTeeth;
    if (tool.helixAngle !== null && tool.helixAngle !== undefined) document.getElementById('helixAngle').value = tool.helixAngle;
    if (tool.rakeAngle !== null && tool.rakeAngle !== undefined) document.getElementById('rakeAngle').value = tool.rakeAngle;
    if (tool.toolCost) document.getElementById('toolCost').value = tool.toolCost;
    if (tool.cuttingSpeed) document.getElementById('cuttingSpeed').value = tool.cuttingSpeed;
    if (tool.feedRate) document.getElementById('feedRate').value = tool.feedRate;
    if (tool.depthOfCut) document.getElementById('depthOfCut').value = tool.depthOfCut;
    if (tool.widthOfCut) document.getElementById('widthOfCut').value = tool.widthOfCut;
}

function addToolToComparison(tool) {
    const params = {
        toolBrand: tool.brand || '',
        toolType: tool.type || '',
        toolNameModel: tool.nameModel || '',
        toolProductCode: tool.productCode || '',
        toolDiameter: tool.diameter || 10,
        toolMaterial: tool.material || 'carbide',
        toolCoating: tool.coating || 'none',
        numberOfTeeth: tool.numberOfTeeth || 4,
        helixAngle: tool.helixAngle || null,
        rakeAngle: tool.rakeAngle || null,
        toolCost: tool.toolCost || 50,
        cuttingSpeed: tool.cuttingSpeed || 100,
        feedRate: tool.feedRate || 0.1,
        depthOfCut: tool.depthOfCut || 2,
        widthOfCut: tool.widthOfCut || 5,
        workpieceMaterial: 'steel',
        processingTime: 10,
        toolChangeCost: 5,
        toolChangeTime: 2,
        machiningTime: null,
        machineHourlyRate: 50,
        toolRemainingCost: 0,
        toolLife: null,
        batchSize: 1
    };
    
    const toolLife = calculateToolLife(params);
    const costResults = calculateCostPerPart({ ...params, toolLife });
    const mrr = calculateMRR(params);
    
    let toolName = tool.nameModel || tool.productCode || `Tool ${toolComparisons.length + 1}`;
    if (tool.brand) {
        toolName = `${tool.brand.charAt(0).toUpperCase() + tool.brand.slice(1)} ${toolName}`;
    }
    
    const toolData = {
        id: Date.now() + Math.random(),
        name: toolName,
        ...params,
        toolLife,
        ...costResults,
        mrr
    };
    
    toolComparisons.push(toolData);
    updateComparisonTable();
}

function closeImportModal() {
    const importModal = document.getElementById('catalogueImportModal');
    importModal.style.display = 'none';
    importedCatalogueData = null;
    fieldMapping = {};
    mappedToolData = [];
    document.getElementById('catalogueFile').value = '';
}

// Report generation functions
function initializeReportGeneration() {
    const generateReportBtn = document.getElementById('generateReportBtn');
    const reportModal = document.getElementById('reportModal');
    const closeReportBtn = document.getElementById('closeReportModal');
    const cancelReportBtn = document.getElementById('cancelReportBtn');
    const sendReportBtn = document.getElementById('sendReportBtn');
    const downloadReportBtn = document.getElementById('downloadReportBtn');
    
    generateReportBtn.addEventListener('click', function() {
        reportModal.style.display = 'block';
    });
    
    closeReportBtn.addEventListener('click', closeReportModal);
    cancelReportBtn.addEventListener('click', closeReportModal);
    
    reportModal.addEventListener('click', function(e) {
        if (e.target === reportModal) {
            closeReportModal();
        }
    });
    
    sendReportBtn.addEventListener('click', function() {
        sendReportByEmail();
    });
    
    downloadReportBtn.addEventListener('click', function() {
        downloadReportPDF();
    });
    
    // Initialize EmailJS (you'll need to set up EmailJS service)
    // For now, we'll use a fallback method
}

function closeReportModal() {
    document.getElementById('reportModal').style.display = 'none';
    document.getElementById('reportStatus').innerHTML = '';
}

function generateReportHTML() {
    const params = getInputValues();
    const toolLife = params.toolLife || calculateToolLife(params);
    const costResults = calculateCostPerPart({ ...params, toolLife });
    const mrr = calculateMRR(params);
    const spindleSpeed = calculateSpindleSpeed(params.cuttingSpeed, params.toolDiameter);
    
    const includeCharts = document.getElementById('includeCharts').checked;
    const includeComparison = document.getElementById('includeComparison').checked;
    
    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>CNC Tool Selection Report</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
                h1 { color: #2563eb; border-bottom: 3px solid #2563eb; padding-bottom: 10px; }
                h2 { color: #1e293b; margin-top: 30px; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; }
                h3 { color: #64748b; margin-top: 20px; }
                table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                th, td { border: 1px solid #e2e8f0; padding: 10px; text-align: left; }
                th { background-color: #f8fafc; font-weight: 600; }
                .highlight { background-color: #f0fdf4; font-weight: 600; }
                .section { margin: 20px 0; padding: 15px; background-color: #f8fafc; border-radius: 8px; }
                .value { font-size: 1.2em; font-weight: 600; color: #2563eb; }
                .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e2e8f0; font-size: 0.9em; color: #64748b; }
            </style>
        </head>
        <body>
            <h1>CNC Tool Selection Report</h1>
            <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>Based on:</strong> ISO 8688-2:1989 - Tool life testing in milling Part 2: End milling</p>
            
            <div class="section">
                <h2>Project Information</h2>
                <table>
                    ${params.clientName ? `<tr><th>Client</th><td>${params.clientName}</td></tr>` : ''}
                    ${params.projectName ? `<tr><th>Project</th><td>${params.projectName}</td></tr>` : ''}
                    ${params.partName ? `<tr><th>Part/Detail</th><td>${params.partName}</td></tr>` : ''}
                    ${params.machineName ? `<tr><th>Machine</th><td>${params.machineName}</td></tr>` : ''}
                    ${params.applicationType ? `<tr><th>Application Type</th><td>${params.applicationType}</td></tr>` : ''}
                    ${params.batchSize > 1 ? `<tr><th>Batch Size</th><td>${params.batchSize} parts</td></tr>` : ''}
                </table>
            </div>
            
            <div class="section">
                <h2>Tool Information</h2>
                <table>
                    ${params.toolBrand ? `<tr><th>Brand</th><td>${params.toolBrand.charAt(0).toUpperCase() + params.toolBrand.slice(1)}</td></tr>` : ''}
                    ${params.toolType ? `<tr><th>Type</th><td>${params.toolType.replace(/([A-Z])/g, ' $1').trim()}</td></tr>` : ''}
                    ${params.toolNameModel ? `<tr><th>Name/Model</th><td>${params.toolNameModel}</td></tr>` : ''}
                    ${params.toolProductCode ? `<tr><th>Product Code</th><td>${params.toolProductCode}</td></tr>` : ''}
                    <tr><th>Diameter</th><td>${params.toolDiameter} mm</td></tr>
                    <tr><th>Number of Teeth</th><td>${params.numberOfTeeth}</td></tr>
                    <tr><th>Tool Material</th><td>${params.toolMaterial}</td></tr>
                    <tr><th>Coating</th><td>${params.toolCoating}</td></tr>
                    <tr><th>Tool Cost</th><td>${formatCurrency(params.toolCost)}</td></tr>
                </table>
            </div>
            
            <div class="section">
                <h2>Cost Analysis</h2>
                <table>
                    <tr><th>Total Cost per Part</th><td class="value">${formatCurrency(costResults.totalCostPerPart)}</td></tr>
                    <tr><th>Tool Cost per Part</th><td>${formatCurrency(costResults.toolCostPerPart)}</td></tr>
                    <tr><th>Machining Cost per Part</th><td>${formatCurrency(costResults.machiningCostPerPart)}</td></tr>
                    ${costResults.toolChangeCostPerPart > 0 ? `<tr><th>Tool Change Cost per Part</th><td>${formatCurrency(costResults.toolChangeCostPerPart)}</td></tr>` : ''}
                    ${params.batchSize > 1 ? `
                    <tr><th>Total Batch Cost (${params.batchSize} parts)</th><td class="value">${formatCurrency(costResults.totalBatchCost)}</td></tr>
                    ` : ''}
                </table>
            </div>
            
            <div class="section">
                <h2>Tool Life & Performance</h2>
                <table>
                    <tr><th>Estimated Tool Life</th><td class="value">${toolLife} minutes</td></tr>
                    <tr><th>Parts per Tool Life</th><td>${costResults.partsPerToolLife} parts</td></tr>
                    <tr><th>Spindle Speed</th><td>${formatNumber(spindleSpeed, 'RPM')}</td></tr>
                    <tr><th>Material Removal Rate</th><td>${formatNumber(mrr, 'mm³/min')}</td></tr>
                </table>
            </div>
            
            <div class="section">
                <h2>Cutting Parameters</h2>
                <table>
                    <tr><th>Cutting Speed (V<sub>c</sub>)</th><td>${params.cuttingSpeed} m/min</td></tr>
                    <tr><th>Feed per Tooth (f<sub>z</sub>)</th><td>${params.feedRate} mm/tooth</td></tr>
                    <tr><th>Axial Depth of Cut (a<sub>p</sub>)</th><td>${params.depthOfCut} mm</td></tr>
                    <tr><th>Radial Width of Cut (a<sub>e</sub>)</th><td>${params.widthOfCut} mm</td></tr>
                    <tr><th>Workpiece Material</th><td>${params.workpieceMaterial}</td></tr>
                </table>
            </div>
    `;
    
    if (includeComparison && toolComparisons.length > 0) {
        html += `
            <div class="section">
                <h2>Tool Comparison</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Tool</th>
                            <th>Brand</th>
                            <th>Cost/Part</th>
                            <th>Tool Life</th>
                            <th>MRR</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        toolComparisons.forEach(tool => {
            html += `
                <tr>
                    <td>${tool.name}</td>
                    <td>${tool.toolBrand ? tool.toolBrand.charAt(0).toUpperCase() + tool.toolBrand.slice(1) : 'N/A'}</td>
                    <td>${formatCurrency(tool.totalCostPerPart)}</td>
                    <td>${tool.toolLife} min</td>
                    <td>${formatNumber(tool.mrr, 'mm³/min')}</td>
                </tr>
            `;
        });
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
    }
    
    html += `
            <div class="footer">
                <p>This report was generated by CNC Tool Selection Calculator</p>
                <p>ISO 8688-2:1989 - Tool life testing in milling Part 2: End milling</p>
            </div>
        </body>
        </html>
    `;
    
    return html;
}

function generateReportText() {
    const params = getInputValues();
    const toolLife = params.toolLife || calculateToolLife(params);
    const costResults = calculateCostPerPart({ ...params, toolLife });
    
    let text = `CNC TOOL SELECTION REPORT
Generated: ${new Date().toLocaleString()}
Based on: ISO 8688-2:1989

PROJECT INFORMATION
${params.clientName ? `Client: ${params.clientName}\n` : ''}${params.projectName ? `Project: ${params.projectName}\n` : ''}${params.partName ? `Part: ${params.partName}\n` : ''}${params.machineName ? `Machine: ${params.machineName}\n` : ''}

TOOL INFORMATION
${params.toolBrand ? `Brand: ${params.toolBrand}\n` : ''}${params.toolNameModel ? `Model: ${params.toolNameModel}\n` : ''}Diameter: ${params.toolDiameter} mm
Number of Teeth: ${params.numberOfTeeth}
Tool Cost: ${formatCurrency(params.toolCost)}

COST ANALYSIS
Total Cost per Part: ${formatCurrency(costResults.totalCostPerPart)}
Tool Cost per Part: ${formatCurrency(costResults.toolCostPerPart)}
Machining Cost per Part: ${formatCurrency(costResults.machiningCostPerPart)}

TOOL LIFE
Estimated Tool Life: ${toolLife} minutes
Parts per Tool Life: ${costResults.partsPerToolLife} parts

---
Generated by CNC Tool Selection Calculator
`;
    
    return text;
}

async function sendReportByEmail() {
    const email = document.getElementById('reportEmail').value;
    const subject = document.getElementById('reportSubject').value;
    const message = document.getElementById('reportMessage').value;
    const statusDiv = document.getElementById('reportStatus');
    
    if (!email || !email.includes('@')) {
        statusDiv.innerHTML = '<p style="color: var(--danger-color);">Please enter a valid email address.</p>';
        return;
    }
    
    statusDiv.innerHTML = '<p style="color: var(--primary-color);">Generating report and sending email...</p>';
    
    try {
        const reportHTML = generateReportHTML();
        const reportText = generateReportText();
        
        // Create email content
        const emailBody = `
${message ? `${message}\n\n` : ''}
${reportText}

---
Full HTML report is attached.
        `;
        
        // For EmailJS integration (requires setup)
        // You'll need to configure EmailJS service ID, template ID, and public key
        // For now, we'll use mailto as fallback
        
        // Create mailto link as fallback
        const mailtoSubject = encodeURIComponent(subject);
        const mailtoBody = encodeURIComponent(emailBody);
        const mailtoLink = `mailto:${email}?subject=${mailtoSubject}&body=${mailtoBody}`;
        
        // Try to use EmailJS if configured, otherwise fallback to mailto
        try {
            // Initialize EmailJS (uncomment and configure when EmailJS is set up)
            // emailjs.init("YOUR_PUBLIC_KEY");
            // 
            // await emailjs.send("YOUR_SERVICE_ID", "YOUR_TEMPLATE_ID", {
            //     to_email: email,
            //     subject: subject,
            //     message: message,
            //     report_html: reportHTML,
            //     report_text: reportText
            // });
            
            // For now, use mailto fallback
            window.location.href = mailtoLink;
            statusDiv.innerHTML = '<p style="color: var(--secondary-color);">✓ Email client opened. Please send the email manually.</p>';
            
            // Also copy report to clipboard
            navigator.clipboard.writeText(reportText).then(() => {
                setTimeout(() => {
                    statusDiv.innerHTML += '<p style="color: var(--text-secondary); font-size: 0.9em;">Report text copied to clipboard.</p>';
                }, 500);
            });
            
        } catch (error) {
            // Fallback to mailto
            window.location.href = mailtoLink;
            statusDiv.innerHTML = '<p style="color: var(--secondary-color);">✓ Email client opened. Report text copied to clipboard.</p>';
        }
        
    } catch (error) {
        statusDiv.innerHTML = `<p style="color: var(--danger-color);">Error generating report: ${error.message}</p>`;
    }
}

async function downloadReportPDF() {
    const statusDiv = document.getElementById('reportStatus');
    statusDiv.innerHTML = '<p style="color: var(--primary-color);">Generating PDF report...</p>';
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        const params = getInputValues();
        const toolLife = params.toolLife || calculateToolLife(params);
        const costResults = calculateCostPerPart({ ...params, toolLife });
        
        let yPos = 20;
        
        // Title
        doc.setFontSize(18);
        doc.setTextColor(37, 99, 235);
        doc.text('CNC Tool Selection Report', 20, yPos);
        yPos += 10;
        
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 20, yPos);
        yPos += 5;
        doc.text('ISO 8688-2:1989 - Tool life testing in milling Part 2: End milling', 20, yPos);
        yPos += 15;
        
        // Project Information
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('Project Information', 20, yPos);
        yPos += 8;
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        if (params.clientName) { doc.text(`Client: ${params.clientName}`, 25, yPos); yPos += 6; }
        if (params.projectName) { doc.text(`Project: ${params.projectName}`, 25, yPos); yPos += 6; }
        if (params.partName) { doc.text(`Part: ${params.partName}`, 25, yPos); yPos += 6; }
        if (params.machineName) { doc.text(`Machine: ${params.machineName}`, 25, yPos); yPos += 6; }
        yPos += 5;
        
        // Tool Information
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('Tool Information', 20, yPos);
        yPos += 8;
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        if (params.toolBrand) { doc.text(`Brand: ${params.toolBrand}`, 25, yPos); yPos += 6; }
        if (params.toolNameModel) { doc.text(`Model: ${params.toolNameModel}`, 25, yPos); yPos += 6; }
        doc.text(`Diameter: ${params.toolDiameter} mm`, 25, yPos); yPos += 6;
        doc.text(`Number of Teeth: ${params.numberOfTeeth}`, 25, yPos); yPos += 6;
        doc.text(`Tool Cost: ${formatCurrency(params.toolCost)}`, 25, yPos); yPos += 10;
        
        // Cost Analysis
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('Cost Analysis', 20, yPos);
        yPos += 8;
        
        doc.setFontSize(12);
        doc.setTextColor(37, 99, 235);
        doc.text(`Total Cost per Part: ${formatCurrency(costResults.totalCostPerPart)}`, 25, yPos);
        yPos += 8;
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text(`Tool Cost per Part: ${formatCurrency(costResults.toolCostPerPart)}`, 25, yPos); yPos += 6;
        doc.text(`Machining Cost per Part: ${formatCurrency(costResults.machiningCostPerPart)}`, 25, yPos); yPos += 10;
        
        // Tool Life
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('Tool Life & Performance', 20, yPos);
        yPos += 8;
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text(`Estimated Tool Life: ${toolLife} minutes`, 25, yPos); yPos += 6;
        doc.text(`Parts per Tool Life: ${costResults.partsPerToolLife} parts`, 25, yPos); yPos += 10;
        
        // Footer
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text('Generated by CNC Tool Selection Calculator', 20, doc.internal.pageSize.height - 10);
        
        // Save PDF
        doc.save(`CNC_Tool_Report_${new Date().toISOString().split('T')[0]}.pdf`);
        
        statusDiv.innerHTML = '<p style="color: var(--secondary-color);">✓ PDF report downloaded successfully!</p>';
        
    } catch (error) {
        statusDiv.innerHTML = `<p style="color: var(--danger-color);">Error generating PDF: ${error.message}</p>`;
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Initialize photo upload
    initializePhotoUpload();
    
    // Initialize catalogue import
    initializeCatalogueImport();
    
    // Initialize report generation
    initializeReportGeneration();
    
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
