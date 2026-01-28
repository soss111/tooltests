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
let currentMachineLabelPhoto = null;

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

// Calculate OEE (Overall Equipment Effectiveness)
function calculateOEE(params, costResults, toolLife) {
    const {
        processingTime,
        toolChangeTime = 0,
        machiningTime,
        toolLife: toolLifeParam,
        defectsRate = 2,
        plannedProductionTime = 8,
        unplannedDowntime = 0.5,
        timeLossPerToolChange = 5,
        partsPerBatch = 100,
        partsPerYear = 4000
    } = params;
    
    // Calculate time per part
    const timePerPart = machiningTime !== null && machiningTime !== undefined 
        ? machiningTime 
        : (processingTime + toolChangeTime);
    
    // Calculate parts per tool life
    const partsPerToolLife = costResults.partsPerToolLife || Math.floor(toolLife / timePerPart);
    
    // Calculate tool change frequency
    const toolChangesPerPart = partsPerToolLife > 0 ? (1 / partsPerToolLife) : 0;
    
    // Calculate downtime per part (in minutes)
    const toolChangeDowntimePerPartMinutes = toolChangesPerPart * timeLossPerToolChange;
    // Approximate unplanned downtime per part: distribute annual unplanned downtime across parts per year
    const partsPerDay = partsPerYear / 365;
    const unplannedDowntimePerPartMinutes = (unplannedDowntime * 60) / partsPerDay;
    const totalDowntimePerPartMinutes = toolChangeDowntimePerPartMinutes + unplannedDowntimePerPartMinutes;
    
    // Calculate ideal cycle time (theoretical minimum time per part - just processing time, no downtime)
    const idealCycleTimeMinutes = processingTime;
    
    // Calculate actual cycle time (including tool changes and downtime)
    const actualCycleTimeMinutes = timePerPart + totalDowntimePerPartMinutes;
    
    // OEE Components:
    
    // 1. Availability = Operating Time / Planned Production Time
    // Operating Time = Planned Time - Downtime
    // For per-part: Availability = 1 - (Downtime / Planned Time Per Part)
    // Planned time per part = planned production time per shift / parts produced per shift
    const partsPerShift = (plannedProductionTime * 60) / actualCycleTimeMinutes; // Approximate parts per shift
    const plannedTimePerPartMinutes = (plannedProductionTime * 60) / partsPerShift;
    const availabilityPerPart = Math.max(0, Math.min(1, 1 - (totalDowntimePerPartMinutes / plannedTimePerPartMinutes)));
    
    // Alternative simpler calculation: Availability = 1 - (Downtime / Total Cycle Time)
    const availabilitySimple = Math.max(0, Math.min(1, 1 - (totalDowntimePerPartMinutes / actualCycleTimeMinutes)));
    
    // Use the simpler calculation for better accuracy
    const availability = availabilitySimple;
    
    // 2. Performance = Ideal Cycle Time / Actual Cycle Time
    // This measures how close actual cycle time is to ideal (no downtime, optimal speed)
    // Performance = (Ideal Output Rate) / (Actual Output Rate) = Ideal Cycle Time / Actual Cycle Time
    const performance = actualCycleTimeMinutes > 0 ? Math.max(0, Math.min(1, idealCycleTimeMinutes / actualCycleTimeMinutes)) : 0;
    
    // Adjust performance based on speed efficiency (higher speed can improve throughput but may reduce tool life)
    const speedEfficiency = 1; // Base efficiency - can be adjusted if speed optimization data available
    const performanceAdjusted = performance * speedEfficiency;
    
    // 3. Quality = Good Parts / Total Parts
    const quality = Math.max(0, Math.min(1, 1 - (defectsRate / 100)));
    
    // Overall OEE
    const oee = availability * performanceAdjusted * quality;
    
    // Calculate OEE losses
    const availabilityLoss = 1 - availability;
    const performanceLoss = 1 - performanceAdjusted;
    const qualityLoss = defectsRate / 100;
    
    // Calculate impact factors
    const toolChangeImpact = {
        downtime: toolChangeDowntimePerPartMinutes / 60, // Convert to hours for consistency
        frequency: toolChangesPerPart,
        cost: costResults.toolChangeCostPerPart || 0
    };
    
    const speedImpact = {
        toolLifeReduction: params.cuttingSpeed > 100 ? ((params.cuttingSpeed - 100) / 100) * 0.1 : 0, // Higher speed reduces tool life
        performanceGain: params.cuttingSpeed > 100 ? Math.min(0.2, (params.cuttingSpeed - 100) / 500) : 0 // Higher speed can improve performance
    };
    
    const toolLifeImpact = {
        toolChanges: costResults.toolChangesPerToolLife || 0,
        downtime: (costResults.toolChangesPerToolLife || 0) * (timeLossPerToolChange / 60),
        cost: costResults.toolChangeCostPerPart || 0
    };
    
    return {
        oee: oee * 100, // Convert to percentage
        availability: availability * 100,
        performance: performanceAdjusted * 100,
        quality: quality * 100,
        availabilityLoss: availabilityLoss * 100,
        performanceLoss: performanceLoss * 100,
        qualityLoss: qualityLoss * 100,
        toolChangeImpact,
        speedImpact,
        toolLifeImpact,
        idealCycleTime: idealCycleTimeMinutes, // Already in minutes
        actualCycleTime: actualCycleTimeMinutes, // Already in minutes
        downtimePerPart: totalDowntimePerPartMinutes, // Already in minutes
        partsPerToolLife,
        toolChangesPerToolLife: costResults.toolChangesPerToolLife || 0
    };
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

// Format cutting fluid name
function formatCuttingFluid(value) {
    if (!value || value === 'none') return 'None (Dry)';
    const fluidNames = {
        'none': 'None (Dry)',
        'flood': 'Flood Coolant',
        'mist': 'Mist Coolant',
        'mql': 'MQL (Minimum Quantity Lubrication)',
        'emulsion': 'Emulsion',
        'synthetic': 'Synthetic Coolant',
        'semiSynthetic': 'Semi-Synthetic Coolant',
        'straightOil': 'Straight Oil',
        'waterSoluble': 'Water-Soluble Oil'
    };
    return fluidNames[value] || value;
}

// Get badge class for metrics
function getBadgeClass(value, thresholds) {
    if (value >= thresholds.excellent) return 'badge-excellent';
    if (value >= thresholds.good) return 'badge-good';
    if (value >= thresholds.fair) return 'badge-fair';
    return 'badge-poor';
}

// Display results
async function displayResults(params, results) {
    // Load Chart.js if needed (before creating charts)
    if (!window.Chart && typeof window.loadChartJS === 'function') {
        await window.loadChartJS();
    }
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
    
    // Calculate OEE
    const oeeResults = calculateOEE(params, costResults, toolLife);
    
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
                ${params.expertName ? `<div class="result-label">Our Expert: <strong>${params.expertName}</strong></div>` : ''}
                ${params.batchSize > 1 ? `<div class="result-label">Batch Size: <strong>${params.batchSize} parts</strong></div>` : ''}
                ${params.theoreticalPartWorktime ? `<div class="result-label">Theoretical Part Worktime: <strong>${params.theoreticalPartWorktime} min</strong></div>` : ''}
                ${params.machineWorkhourCost ? `<div class="result-label">Machine Workhour Cost: <strong>${formatCurrency(params.machineWorkhourCost)}/hour</strong></div>` : ''}
                ${params.machineStopCost ? `<div class="result-label">Machine Stop Cost: <strong>${formatCurrency(params.machineStopCost)}/hour</strong></div>` : ''}
            </div>
            ${params.partsPerBatch || params.partsPerYear || params.annualSolutions ? `
            <div class="result-item" style="background: #f0fdf4; border-left-color: #10b981;">
                <h3>📊 Production & Cost Parameters</h3>
                ${params.partsPerBatch ? `<div class="result-label">Parts per Batch: <strong>${params.partsPerBatch}</strong></div>` : ''}
                ${params.partsPerYear ? `<div class="result-label">Parts per Year: <strong>${params.partsPerYear}</strong></div>` : ''}
                ${params.annualSolutions ? `<div class="result-label">Annual Solutions: <strong>${params.annualSolutions}</strong></div>` : ''}
                ${params.machineCostPerHour ? `<div class="result-label">Machine Cost per Hour: <strong>${formatCurrency(params.machineCostPerHour)}/hour</strong></div>` : ''}
                ${params.costOfToolChange ? `<div class="result-label">Cost of Tool Change: <strong>${formatCurrency(params.costOfToolChange)}</strong></div>` : ''}
                ${params.timeLossPerToolChange ? `<div class="result-label">Time Loss per Tool Change: <strong>${params.timeLossPerToolChange} min</strong></div>` : ''}
                ${params.machineStopDowntimeCost ? `<div class="result-label">Machine Stop/Downtime Cost: <strong>${formatCurrency(params.machineStopDowntimeCost)}/hour</strong></div>` : ''}
            </div>
            ` : ''}
            ${params.toolBrand || params.toolNameModel || params.toolProductCode ? `
            <div class="result-item" style="background: #fef3c7; border-left-color: #f59e0b;">
                <h3>🔧 Tool Information</h3>
                ${params.toolBrand ? `<div class="result-label">Brand: <strong>${params.toolBrand.charAt(0).toUpperCase() + params.toolBrand.slice(1)}</strong></div>` : ''}
                ${params.toolType ? `<div class="result-label">Type: <strong>${params.toolType.replace(/([A-Z])/g, ' $1').trim()}</strong></div>` : ''}
                ${params.toolNameModel ? `<div class="result-label">Name/Model: <strong>${params.toolNameModel}</strong></div>` : ''}
                ${params.toolProductCode ? `<div class="result-label">Product Code: <strong>${params.toolProductCode}</strong></div>` : ''}
                ${params.cuttingFluid && params.cuttingFluid !== 'none' ? `<div class="result-label">Cutting Fluid: <strong>${formatCuttingFluid(params.cuttingFluid)}</strong></div>` : ''}
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
    
    // Calculate net tool cost for display
    const netToolCost = params.toolCost - (params.toolRemainingCost || 0);
    
    let html = projectInfoHtml + `
        <div class="result-item cost-analysis-card">
            <div class="result-header-visual">
                <span class="result-icon">💰</span>
                <h3>Cost Analysis</h3>
            </div>
            <div class="result-value-card">
                <div class="result-label">Total Cost per Part</div>
                <div class="result-value-large">${formatCurrency(costResults.totalCostPerPart)}</div>
                ${toolComparisons.length > 0 ? `
                    <div class="result-comparison-badge">
                        ${(() => {
                            const bestComparisonCost = Math.min(...toolComparisons.map(t => t.totalCostPerPart));
                            const vsBest = costResults.totalCostPerPart - bestComparisonCost;
                            if (costResults.totalCostPerPart === bestComparisonCost) {
                                return '<span class="best-indicator">🏆 Best in comparison</span>';
                            } else if (vsBest > 0) {
                                const percentDiff = ((vsBest / bestComparisonCost) * 100).toFixed(1);
                                return `<span class="worse-indicator">+${formatCurrency(vsBest)} (${percentDiff}% more than best)</span>`;
                            }
                            return '';
                        })()}
                    </div>
                ` : ''}
            </div>
            <div class="result-description">
                <strong>Breakdown:</strong><br>
                • Tool cost: ${formatCurrency(costResults.toolCostPerPart)}${params.toolRemainingCost > 0 ? ` (Net: ${formatCurrency(params.toolCost)} - ${formatCurrency(params.toolRemainingCost)} = ${formatCurrency(netToolCost)})` : ''}<br>
                ${costResults.toolChangeCostPerPart > 0 ? `• Tool change cost: ${formatCurrency(costResults.toolChangeCostPerPart)}<br>` : ''}
                • Machining cost: ${formatCurrency(costResults.machiningCostPerPart)}<br>
                ${costResults.processingCostPerPart ? `• Processing (cutting) cost: ${formatCurrency(costResults.processingCostPerPart)}<br>` : ''}
                ${params.toolRemainingCost > 0 ? `<br><small style="color: var(--text-secondary);">💡 Tool Residual Value (C<sub>r</sub>): ${formatCurrency(params.toolRemainingCost)} reduces effective tool cost from ${formatCurrency(params.toolCost)} to ${formatCurrency(netToolCost)}</small>` : ''}
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
        
        <div class="result-item" style="background: #f0f9ff; border-left-color: #3b82f6;">
            <h3>📈 OEE Analysis (Overall Equipment Effectiveness)</h3>
            <div class="result-label">Overall OEE</div>
            <div class="result-value" style="font-size: 2em; color: ${oeeResults.oee >= 85 ? '#10b981' : oeeResults.oee >= 60 ? '#f59e0b' : '#ef4444'};">
                ${oeeResults.oee.toFixed(1)}%
            </div>
            <div class="result-description">
                OEE = Availability × Performance × Quality
            </div>
            
            <div style="margin-top: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <div class="result-label" style="font-size: 0.9em; color: #64748b;">Availability</div>
                    <div class="result-value" style="font-size: 1.5em; color: ${oeeResults.availability >= 90 ? '#10b981' : oeeResults.availability >= 80 ? '#f59e0b' : '#ef4444'};">
                        ${oeeResults.availability.toFixed(1)}%
                    </div>
                    <div style="font-size: 0.85em; color: #64748b; margin-top: 5px;">
                        Loss: ${oeeResults.availabilityLoss.toFixed(1)}%
                    </div>
                </div>
                
                <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <div class="result-label" style="font-size: 0.9em; color: #64748b;">Performance</div>
                    <div class="result-value" style="font-size: 1.5em; color: ${oeeResults.performance >= 90 ? '#10b981' : oeeResults.performance >= 80 ? '#f59e0b' : '#ef4444'};">
                        ${oeeResults.performance.toFixed(1)}%
                    </div>
                    <div style="font-size: 0.85em; color: #64748b; margin-top: 5px;">
                        Loss: ${oeeResults.performanceLoss.toFixed(1)}%
                    </div>
                </div>
                
                <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <div class="result-label" style="font-size: 0.9em; color: #64748b;">Quality</div>
                    <div class="result-value" style="font-size: 1.5em; color: ${oeeResults.quality >= 99 ? '#10b981' : oeeResults.quality >= 95 ? '#f59e0b' : '#ef4444'};">
                        ${oeeResults.quality.toFixed(1)}%
                    </div>
                    <div style="font-size: 0.85em; color: #64748b; margin-top: 5px;">
                        Defects: ${params.defectsRate || 2}%
                    </div>
                </div>
            </div>
            
            <div style="margin-top: 20px; padding: 15px; background: white; border-radius: 8px; border: 1px solid #e2e8f0;">
                <h4 style="margin-top: 0; color: #1e293b; font-size: 1.1em;">🔍 OEE Impact Factors</h4>
                
                <div style="margin-top: 15px;">
                    <strong style="color: #64748b;">Tool Change Impact:</strong>
                    <ul style="margin: 8px 0; padding-left: 20px; color: #475569;">
                        <li>Downtime per part: ${oeeResults.toolChangeImpact.downtime.toFixed(3)} hours (${(oeeResults.toolChangeImpact.downtime * 60).toFixed(2)} min)</li>
                        <li>Tool changes per part: ${(oeeResults.toolChangeImpact.frequency * 100).toFixed(2)}%</li>
                        <li>Cost impact: ${formatCurrency(oeeResults.toolChangeImpact.cost)} per part</li>
                        <li>Parts per tool life: ${oeeResults.partsPerToolLife}</li>
                        <li>Tool changes per tool life: ${oeeResults.toolChangesPerToolLife}</li>
                    </ul>
                </div>
                
                <div style="margin-top: 15px;">
                    <strong style="color: #64748b;">Speed Impact:</strong>
                    <ul style="margin: 8px 0; padding-left: 20px; color: #475569;">
                        <li>Cutting speed: ${params.cuttingSpeed} m/min</li>
                        ${oeeResults.speedImpact.toolLifeReduction > 0 ? `<li>Tool life reduction: ${(oeeResults.speedImpact.toolLifeReduction * 100).toFixed(1)}% (higher speed reduces tool life)</li>` : ''}
                        ${oeeResults.speedImpact.performanceGain > 0 ? `<li>Performance gain: ${(oeeResults.speedImpact.performanceGain * 100).toFixed(1)}% (higher speed improves throughput)</li>` : ''}
                    </ul>
                </div>
                
                <div style="margin-top: 15px;">
                    <strong style="color: #64748b;">Tool Life Impact:</strong>
                    <ul style="margin: 8px 0; padding-left: 20px; color: #475569;">
                        <li>Tool life: ${toolLife} minutes</li>
                        <li>Downtime from tool changes: ${(oeeResults.toolLifeImpact.downtime * 60).toFixed(2)} min per tool life</li>
                        <li>Cost from tool changes: ${formatCurrency(oeeResults.toolLifeImpact.cost)} per part</li>
                        ${toolLife < 60 ? `<li style="color: #ef4444;">⚠️ Short tool life increases downtime and reduces availability</li>` : ''}
                    </ul>
                </div>
                
                <div style="margin-top: 15px;">
                    <strong style="color: #64748b;">Machine Stop Impact:</strong>
                    <ul style="margin: 8px 0; padding-left: 20px; color: #475569;">
                        <li>Downtime per part: ${oeeResults.downtimePerPart.toFixed(2)} min</li>
                        <li>Ideal cycle time: ${oeeResults.idealCycleTime.toFixed(2)} min</li>
                        <li>Actual cycle time: ${oeeResults.actualCycleTime.toFixed(2)} min</li>
                        ${params.unplannedDowntime > 0 ? `<li>Unplanned downtime: ${params.unplannedDowntime} hours/shift</li>` : ''}
                    </ul>
                </div>
                
                <div style="margin-top: 15px;">
                    <strong style="color: #64748b;">Defects Rate Impact:</strong>
                    <ul style="margin: 8px 0; padding-left: 20px; color: #475569;">
                        <li>Defects rate: ${params.defectsRate || 2}%</li>
                        <li>Quality loss: ${oeeResults.qualityLoss.toFixed(1)}%</li>
                        ${(params.defectsRate || 2) > 5 ? `<li style="color: #ef4444;">⚠️ High defects rate significantly reduces OEE quality component</li>` : ''}
                    </ul>
                </div>
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
            ${params.cuttingFluid && params.cuttingFluid !== 'none' ? `
            <tr>
                <td>Cutting Fluid</td>
                <td>-</td>
                <td>${formatCuttingFluid(params.cuttingFluid)}</td>
                <td>-</td>
            </tr>
            ` : ''}
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
        expertName: document.getElementById('expertName').value.trim(),
        machineName: document.getElementById('machineName').value.trim(),
        machineLabelPhoto: currentMachineLabelPhoto,
        partName: document.getElementById('partName').value.trim(),
        applicationType: document.getElementById('applicationType').value,
        batchSize: parseInt(document.getElementById('batchSize').value) || 1,
        theoreticalPartWorktime: document.getElementById('theoreticalPartWorktime').value ? parseFloat(document.getElementById('theoreticalPartWorktime').value) : null,
        machineWorkhourCost: parseFloat(document.getElementById('machineWorkhourCost').value) || 50,
        machineStopCost: parseFloat(document.getElementById('machineStopCost').value) || 50,
        
        // Production & Cost Parameters
        partsPerBatch: parseInt(document.getElementById('partsPerBatch').value) || 100,
        partsPerYear: parseInt(document.getElementById('partsPerYear').value) || 4000,
        annualSolutions: parseInt(document.getElementById('annualSolutions').value) || 6,
        machineCostPerHour: parseFloat(document.getElementById('machineCostPerHour').value) || 50,
        costOfToolChange: parseFloat(document.getElementById('costOfToolChange').value) || 5,
        timeLossPerToolChange: parseFloat(document.getElementById('timeLossPerToolChange').value) || 5,
        machineStopDowntimeCost: parseFloat(document.getElementById('machineStopDowntimeCost').value) || 50,
        defectsRate: parseFloat(document.getElementById('defectsRate').value) || 2,
        plannedProductionTime: parseFloat(document.getElementById('plannedProductionTime').value) || 8,
        unplannedDowntime: parseFloat(document.getElementById('unplannedDowntime').value) || 0.5,
        
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
        cuttingFluid: document.getElementById('cuttingFluid').value,
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
    updateComparisonTable().catch(error => console.error('Error updating comparison table:', error));
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
async function updateComparisonTable() {
    // Load Chart.js if needed (before creating charts)
    if (!window.Chart && typeof window.loadChartJS === 'function') {
        await window.loadChartJS();
    }
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
    
    // Find best tool (lowest cost)
    const bestTool = toolComparisons.find(t => t.totalCostPerPart === bestTotalCost);
    const worstTool = toolComparisons.reduce((worst, current) => 
        current.totalCostPerPart > worst.totalCostPerPart ? current : worst
    );
    
    // Calculate savings and improvements
    const costDifference = worstTool.totalCostPerPart - bestTool.totalCostPerPart;
    const costSavingsPercent = ((costDifference / worstTool.totalCostPerPart) * 100).toFixed(1);
    const toolLifeImprovement = bestToolLife - Math.min(...toolComparisons.map(t => t.toolLife));
    const toolLifeImprovementPercent = toolLifeImprovement > 0 ? 
        ((toolLifeImprovement / Math.min(...toolComparisons.map(t => t.toolLife))) * 100).toFixed(1) : 0;
    const mrrImprovement = bestMRR - Math.min(...toolComparisons.map(t => t.mrr));
    const mrrImprovementPercent = mrrImprovement > 0 ? 
        ((mrrImprovement / Math.min(...toolComparisons.map(t => t.mrr))) * 100).toFixed(1) : 0;
    
    // Calculate savings
    calculateAndDisplaySavings();
    
    // Display comparison charts
    displayComparisonCharts();
    
    // Create visual summary cards
    let html = `
        <div class="comparison-summary-cards">
            <div class="summary-card best-tool-card">
                <div class="summary-card-header">
                    <span class="summary-icon">🏆</span>
                    <h3>Best Tool</h3>
                </div>
                <div class="summary-card-content">
                    <div class="summary-tool-name">${bestTool.name || 'Tool 1'}</div>
                    <div class="summary-metrics">
                        <div class="summary-metric">
                            <span class="metric-label">Cost/Part</span>
                            <span class="metric-value best">${formatCurrency(bestTool.totalCostPerPart)}</span>
                        </div>
                        <div class="summary-metric">
                            <span class="metric-label">Tool Life</span>
                            <span class="metric-value best">${bestTool.toolLife} min</span>
                        </div>
                        <div class="summary-metric">
                            <span class="metric-label">MRR</span>
                            <span class="metric-value best">${formatNumber(bestTool.mrr, 'mm³/min')}</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="summary-card savings-card">
                <div class="summary-card-header">
                    <span class="summary-icon">💰</span>
                    <h3>Potential Savings</h3>
                </div>
                <div class="summary-card-content">
                    <div class="savings-amount">${formatCurrency(costDifference)}</div>
                    <div class="savings-percent">${costSavingsPercent}% reduction</div>
                    <div class="savings-details">
                        <div>vs. most expensive tool</div>
                        <div class="savings-breakdown">
                            <span>Per part: ${formatCurrency(costDifference)}</span>
                            ${bestTool.batchSize > 1 ? `<span>Per batch: ${formatCurrency(costDifference * bestTool.batchSize)}</span>` : ''}
                            <span>Per 100 parts: ${formatCurrency(costDifference * 100)}</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="summary-card improvements-card">
                <div class="summary-card-header">
                    <span class="summary-icon">📈</span>
                    <h3>Performance Improvements</h3>
                </div>
                <div class="summary-card-content">
                    <div class="improvement-item">
                        <span class="improvement-label">Tool Life</span>
                        <span class="improvement-value">+${toolLifeImprovement.toFixed(1)} min</span>
                        <span class="improvement-percent">(${toolLifeImprovementPercent}% better)</span>
                    </div>
                    <div class="improvement-item">
                        <span class="improvement-label">Material Removal Rate</span>
                        <span class="improvement-value">+${formatNumber(mrrImprovement, 'mm³/min')}</span>
                        <span class="improvement-percent">(${mrrImprovementPercent}% better)</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="comparison-tools-grid">
    `;
    
    // Create visual cards for each tool
    toolComparisons.forEach((tool, index) => {
        const isBest = tool.totalCostPerPart === bestTotalCost;
        const costVsBest = tool.totalCostPerPart - bestTotalCost;
        const costVsBestPercent = bestTotalCost > 0 ? ((costVsBest / bestTotalCost) * 100).toFixed(1) : 0;
        const toolLifeVsBest = tool.toolLife - bestToolLife;
        const mrrVsBest = tool.mrr - bestMRR;
        
        html += `
            <div class="tool-comparison-card ${isBest ? 'best-tool-highlight' : ''}" data-tool-id="${tool.id}">
                ${isBest ? '<div class="best-tool-badge">🏆 BEST CHOICE</div>' : ''}
                <div class="tool-card-header">
                    <h4 class="tool-card-name">${tool.name}</h4>
                    ${tool.toolBrand ? `<div class="tool-card-brand">${tool.toolBrand.charAt(0).toUpperCase() + tool.toolBrand.slice(1)}</div>` : ''}
                </div>
                <div class="tool-card-body">
                    <div class="tool-metric-row">
                        <span class="tool-metric-label">💰 Cost per Part</span>
                        <span class="tool-metric-value ${tool.totalCostPerPart === bestTotalCost ? 'best-metric' : costVsBest > 0 ? 'worse-metric' : ''}">
                            ${formatCurrency(tool.totalCostPerPart)}
                            ${!isBest && costVsBest > 0 ? `<span class="metric-diff">+${formatCurrency(costVsBest)} (${costVsBestPercent}%)</span>` : ''}
                            ${tool.totalCostPerPart === bestTotalCost ? '<span class="best-badge">✓ Best</span>' : ''}
                        </span>
                    </div>
                    <div class="tool-metric-row">
                        <span class="tool-metric-label">⏱️ Tool Life</span>
                        <span class="tool-metric-value ${tool.toolLife === bestToolLife ? 'best-metric' : toolLifeVsBest < 0 ? 'worse-metric' : ''}">
                            ${tool.toolLife} min
                            ${tool.toolLife === bestToolLife ? '<span class="best-badge">✓ Best</span>' : toolLifeVsBest < 0 ? `<span class="metric-diff">${toolLifeVsBest.toFixed(1)} min</span>` : ''}
                        </span>
                    </div>
                    <div class="tool-metric-row">
                        <span class="tool-metric-label">⚡ MRR</span>
                        <span class="tool-metric-value ${tool.mrr === bestMRR ? 'best-metric' : mrrVsBest < 0 ? 'worse-metric' : ''}">
                            ${formatNumber(tool.mrr, 'mm³/min')}
                            ${tool.mrr === bestMRR ? '<span class="best-badge">✓ Best</span>' : mrrVsBest < 0 ? `<span class="metric-diff">${formatNumber(mrrVsBest, 'mm³/min')}</span>` : ''}
                        </span>
                    </div>
                    <div class="tool-metric-row">
                        <span class="tool-metric-label">🔧 Tool Cost</span>
                        <span class="tool-metric-value">${formatCurrency(tool.toolCost)}</span>
                    </div>
                    <div class="tool-card-details">
                        <div class="tool-detail-item">
                            <span>Type:</span> <strong>${tool.toolType ? tool.toolType.replace(/([A-Z])/g, ' $1').trim() : 'N/A'}</strong>
                        </div>
                        <div class="tool-detail-item">
                            <span>Material:</span> <strong>${tool.toolMaterial}</strong>
                        </div>
                        <div class="tool-detail-item">
                            <span>Coating:</span> <strong>${tool.toolCoating}</strong>
                        </div>
                    </div>
                </div>
                <div class="tool-card-actions">
                    <button class="btn-edit-tool" data-tool-id="${tool.id}" title="Edit tool parameters">✏️ Edit</button>
                    <button class="btn-delete-tool" data-tool-id="${tool.id}" title="Remove tool from comparison">🗑️ Delete</button>
                </div>
            </div>
        `;
    });
    
    html += `
        </div>
        
        <div class="comparison-table-container">
            <h3 style="margin-bottom: 10px; color: var(--text-primary);">📊 Detailed Comparison Table</h3>
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
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    toolComparisons.forEach((tool, index) => {
        html += `
            <tr data-tool-id="${tool.id}" class="${tool.totalCostPerPart === bestTotalCost ? 'best-tool-row' : ''}">
                <td><strong>${tool.name}</strong>${tool.totalCostPerPart === bestTotalCost ? ' 🏆' : ''}</td>
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
                <td>
                    <button class="btn-edit-tool" data-tool-id="${tool.id}" title="Edit tool parameters" style="padding: 4px 8px; font-size: 0.85rem; margin-right: 4px;">✏️ Edit</button>
                    <button class="btn-delete-tool" data-tool-id="${tool.id}" title="Remove tool from comparison" style="padding: 4px 8px; font-size: 0.85rem; background: var(--danger-color); color: white;">🗑️ Delete</button>
                </td>
            </tr>
        `;
    });
    
    html += `
                </tbody>
            </table>
        </div>
    `;
    
    comparisonResults.innerHTML = html;
    
    // Add event listeners for edit and delete buttons
    comparisonResults.querySelectorAll('.btn-edit-tool').forEach(btn => {
        btn.addEventListener('click', function() {
            const toolId = parseFloat(this.dataset.toolId);
            editToolFromComparison(toolId);
        });
    });
    
    comparisonResults.querySelectorAll('.btn-delete-tool').forEach(btn => {
        btn.addEventListener('click', function() {
            const toolId = parseFloat(this.dataset.toolId);
            deleteToolFromComparison(toolId);
        });
    });
}

// Edit tool from comparison - load tool data into form
function editToolFromComparison(toolId) {
    const tool = toolComparisons.find(t => t.id === toolId);
    if (!tool) {
        showToast('Tool not found', 'error');
        return;
    }
    
    // Store the tool ID being edited
    window.editingToolId = toolId;
    
    // Load tool data into form fields
    if (tool.toolBrand) document.getElementById('toolBrand').value = tool.toolBrand;
    if (tool.toolType) document.getElementById('toolType').value = tool.toolType;
    if (tool.toolNameModel) document.getElementById('toolNameModel').value = tool.toolNameModel;
    if (tool.toolProductCode) document.getElementById('toolProductCode').value = tool.toolProductCode;
    if (tool.toolDiameter) document.getElementById('toolDiameter').value = tool.toolDiameter;
    if (tool.numberOfTeeth) document.getElementById('numberOfTeeth').value = tool.numberOfTeeth;
    if (tool.toolMaterial) document.getElementById('toolMaterial').value = tool.toolMaterial;
    if (tool.toolCoating) document.getElementById('toolCoating').value = tool.toolCoating;
    if (tool.cuttingFluid) document.getElementById('cuttingFluid').value = tool.cuttingFluid;
    if (tool.helixAngle !== null && tool.helixAngle !== undefined) document.getElementById('helixAngle').value = tool.helixAngle;
    if (tool.rakeAngle !== null && tool.rakeAngle !== undefined) document.getElementById('rakeAngle').value = tool.rakeAngle;
    if (tool.cuttingSpeed) document.getElementById('cuttingSpeed').value = tool.cuttingSpeed;
    if (tool.feedRate) document.getElementById('feedRate').value = tool.feedRate;
    if (tool.depthOfCut) document.getElementById('depthOfCut').value = tool.depthOfCut;
    if (tool.widthOfCut) document.getElementById('widthOfCut').value = tool.widthOfCut;
    if (tool.workpieceMaterial) document.getElementById('workpieceMaterial').value = tool.workpieceMaterial;
    if (tool.materialHardness) document.getElementById('materialHardness').value = tool.materialHardness;
    if (tool.toolCost) document.getElementById('toolCost').value = tool.toolCost;
    if (tool.toolRemainingCost !== undefined) document.getElementById('toolRemainingCost').value = tool.toolRemainingCost || 0;
    if (tool.processingTime) document.getElementById('processingTime').value = tool.processingTime;
    if (tool.toolChangeCost !== undefined) document.getElementById('toolChangeCost').value = tool.toolChangeCost || 0;
    if (tool.toolChangeTime !== undefined) document.getElementById('toolChangeTime').value = tool.toolChangeTime || 0;
    if (tool.machiningTime !== null && tool.machiningTime !== undefined) document.getElementById('machiningTime').value = tool.machiningTime;
    if (tool.machineHourlyRate) document.getElementById('machineHourlyRate').value = tool.machineHourlyRate;
    if (tool.toolLife) document.getElementById('toolLife').value = tool.toolLife;
    
    // Load project information
    if (tool.clientName) document.getElementById('clientName').value = tool.clientName;
    if (tool.projectName) document.getElementById('projectName').value = tool.projectName;
    if (tool.partName) document.getElementById('partName').value = tool.partName;
    if (tool.machineName) document.getElementById('machineName').value = tool.machineName;
    if (tool.applicationType) document.getElementById('applicationType').value = tool.applicationType;
    if (tool.customerContact) document.getElementById('customerContact').value = tool.customerContact;
    if (tool.expertName) document.getElementById('expertName').value = tool.expertName;
    if (tool.batchSize) document.getElementById('batchSize').value = tool.batchSize;
    if (tool.theoreticalPartWorktime) document.getElementById('theoreticalPartWorktime').value = tool.theoreticalPartWorktime;
    if (tool.machineWorkhourCost) document.getElementById('machineWorkhourCost').value = tool.machineWorkhourCost;
    if (tool.machineStopCost) document.getElementById('machineStopCost').value = tool.machineStopCost;
    
    // Load production & cost parameters
    if (tool.partsPerBatch) document.getElementById('partsPerBatch').value = tool.partsPerBatch;
    if (tool.partsPerYear) document.getElementById('partsPerYear').value = tool.partsPerYear;
    if (tool.annualSolutions) document.getElementById('annualSolutions').value = tool.annualSolutions;
    if (tool.machineCostPerHour) document.getElementById('machineCostPerHour').value = tool.machineCostPerHour;
    if (tool.costOfToolChange) document.getElementById('costOfToolChange').value = tool.costOfToolChange;
    if (tool.timeLossPerToolChange) document.getElementById('timeLossPerToolChange').value = tool.timeLossPerToolChange;
    if (tool.machineStopDowntimeCost) document.getElementById('machineStopDowntimeCost').value = tool.machineStopDowntimeCost;
    if (tool.defectsRate) document.getElementById('defectsRate').value = tool.defectsRate;
    if (tool.plannedProductionTime) document.getElementById('plannedProductionTime').value = tool.plannedProductionTime;
    if (tool.unplannedDowntime) document.getElementById('unplannedDowntime').value = tool.unplannedDowntime;
    
    // Load tool photo if available
    if (tool.toolPhoto) {
        currentToolPhoto = tool.toolPhoto;
        currentPhotoDate = tool.photoDate;
        const photoPreview = document.getElementById('photoPreview');
        const photoPreviewImg = document.getElementById('photoPreviewImg');
        const photoPreviewContainer = document.getElementById('photoPreviewContainer');
        const photoDateInfo = document.getElementById('photoDateInfo');
        
        if (photoPreviewImg) {
            photoPreviewImg.src = tool.toolPhoto;
            photoPreviewContainer.style.display = 'block';
            if (tool.photoDate && photoDateInfo) {
                photoDateInfo.textContent = `Photo Date: ${formatDate(tool.photoDate)}`;
            }
        }
    }
    
    // Change "Add to Comparison" button to "Update Tool"
    const addToolBtn = document.getElementById('addToolBtn');
    if (addToolBtn) {
        addToolBtn.textContent = '💾 Update Tool';
    }
    
    // Scroll to form
    document.querySelector('.input-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    showToast(`Editing tool: ${tool.name}. Make changes and click "Update Tool" to save.`, 'info', 4000);
}

// Update tool in comparison
function updateToolInComparison(toolId) {
    const toolIndex = toolComparisons.findIndex(t => t.id === toolId);
    if (toolIndex === -1) {
        showToast('Tool not found in comparison', 'error');
        return;
    }
    
    const params = getInputValues();
    const toolLife = params.toolLife || calculateToolLife(params);
    const costResults = calculateCostPerPart({ ...params, toolLife });
    const mrr = calculateMRR(params);
    
    // Create descriptive tool name
    let toolName = `Tool ${toolIndex + 1}`;
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
    
    // Update tool data
    toolComparisons[toolIndex] = {
        id: toolId, // Keep original ID
        name: toolName,
        ...params,
        toolLife,
        ...costResults,
        mrr,
        toolPhoto: params.toolPhoto,
        photoDate: params.photoDate
    };
    
    // Reset button
    const addToolBtn = document.getElementById('addToolBtn');
    if (addToolBtn) {
        addToolBtn.textContent = 'Add Another Tool';
    }
    
    // Clear editing flag
    window.editingToolId = null;
    
    // Recalculate and update display
    updateComparisonTable().catch(error => console.error('Error updating comparison table:', error));
    calculateAndDisplaySavings();
    displayComparisonCharts();
    
    // Recalculate main results if this was the last tool added
    const calculateBtn = document.getElementById('calculateBtn');
    if (calculateBtn) {
        calculateBtn.click();
    }
    
    showToast(`Tool "${toolName}" updated successfully`, 'success');
}

// Delete tool from comparison
function deleteToolFromComparison(toolId) {
    if (!confirm('Are you sure you want to remove this tool from the comparison?')) {
        return;
    }
    
    const toolIndex = toolComparisons.findIndex(t => t.id === toolId);
    if (toolIndex === -1) {
        showToast('Tool not found', 'error');
        return;
    }
    
    const toolName = toolComparisons[toolIndex].name;
    toolComparisons.splice(toolIndex, 1);
    
    updateComparisonTable();
    calculateAndDisplaySavings();
    displayComparisonCharts();
    
    showToast(`Tool "${toolName}" removed from comparison`, 'success');
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
    updateComparisonTable().catch(error => console.error('Error updating comparison table:', error));
}

// Save current tool and clear form for new tool entry
function saveAndClearForm() {
    const params = getInputValues();
    const validationErrors = validateInputs(params);
    
    if (validationErrors.length > 0) {
        showToast(`⚠️ Please fix errors before saving: ${validationErrors[0]}`, 'error', 5000);
        return;
    }
    
    // If editing, update instead of adding
    if (window.editingToolId) {
        updateToolInComparison(window.editingToolId);
    } else {
        // Add current tool to comparison
        addToComparison();
    }
    
    // Clear editing mode
    window.editingToolId = null;
    
    // Clear form fields (but keep some defaults)
    document.getElementById('toolBrand').value = '';
    document.getElementById('toolType').value = '';
    document.getElementById('toolNameModel').value = '';
    document.getElementById('toolProductCode').value = '';
    document.getElementById('toolDiameter').value = '10';
    document.getElementById('numberOfTeeth').value = '4';
    document.getElementById('toolMaterial').value = 'carbide';
    document.getElementById('toolCoating').value = 'none';
    document.getElementById('cuttingFluid').value = 'none';
    document.getElementById('helixAngle').value = '30';
    document.getElementById('rakeAngle').value = '5';
    document.getElementById('cuttingSpeed').value = '100';
    document.getElementById('feedRate').value = '0.1';
    document.getElementById('depthOfCut').value = '2';
    document.getElementById('widthOfCut').value = '5';
    document.getElementById('toolCost').value = '50';
    document.getElementById('toolRemainingCost').value = '0';
    document.getElementById('toolLife').value = '';
    document.getElementById('materialHardness').value = '30';
    document.getElementById('processingTime').value = '10';
    document.getElementById('toolChangeCost').value = '5';
    document.getElementById('toolChangeTime').value = '2';
    document.getElementById('machiningTime').value = '10';
    document.getElementById('machineHourlyRate').value = '50';
    
    // Clear new project information fields
    document.getElementById('theoreticalPartWorktime').value = '';
    document.getElementById('machineWorkhourCost').value = '50';
    document.getElementById('machineStopCost').value = '50';
    
    // Clear production & cost parameters
    document.getElementById('partsPerBatch').value = '100';
    document.getElementById('partsPerYear').value = '4000';
    document.getElementById('annualSolutions').value = '6';
    document.getElementById('machineCostPerHour').value = '50';
    document.getElementById('costOfToolChange').value = '5';
    document.getElementById('timeLossPerToolChange').value = '5';
    document.getElementById('machineStopDowntimeCost').value = '50';
    document.getElementById('defectsRate').value = '2';
    document.getElementById('plannedProductionTime').value = '8';
    document.getElementById('unplannedDowntime').value = '0.5';
    
    // Reset editing mode and button text
    window.editingToolId = null;
    const addToolBtn = document.getElementById('addToolBtn');
    if (addToolBtn) {
        addToolBtn.textContent = 'Add Another Tool';
    }
    
    // Clear photo
    currentToolPhoto = null;
    currentPhotoDate = null;
    const photoPreviewContainerEl = document.getElementById('photoPreviewContainer');
    if (photoPreviewContainerEl) {
        photoPreviewContainerEl.style.display = 'none';
    }
    const photoPreviewEl = document.getElementById('photoPreview');
    if (photoPreviewEl) {
        photoPreviewEl.innerHTML = '<p style="color: #64748b;">No photo uploaded</p>';
    }
    const toolPhotoFileInput = document.getElementById('toolPhoto');
    if (toolPhotoFileInput) {
        toolPhotoFileInput.value = '';
    }
    
    // Clear results
    document.getElementById('results').innerHTML = '<div class="result-placeholder"><p>Enter parameters and click "Calculate" to see engineering analysis</p></div>';
    document.getElementById('technicalSpecs').style.display = 'none';
    document.getElementById('engineeringFormulas').style.display = 'none';
    document.getElementById('recommendations').style.display = 'none';
    document.getElementById('toolLifeChart').style.display = 'none';
    document.getElementById('costSavingsChart').style.display = 'none';
    
    // Destroy chart instances
    if (toolLifeChartInstance) {
        toolLifeChartInstance.destroy();
        toolLifeChartInstance = null;
    }
    if (costSavingsChartInstance) {
        costSavingsChartInstance.destroy();
        costSavingsChartInstance = null;
    }
    
    // Show success message
    const toolName = params.toolNameModel || params.toolBrand || `Tool ${toolComparisons.length}`;
    showToast(`✅ "${toolName}" saved to comparison. Form cleared for new tool entry.`, 'success', 4000);
    
    // Scroll to top of form
    document.querySelector('.calculator-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Machine label OCR functions
function initializeMachineLabelUpload() {
    console.log('Initializing machine label upload...');
    const fileInput = document.getElementById('machineLabelPhoto');
    const uploadBtn = document.getElementById('uploadMachineLabelBtn');
    const previewContainer = document.getElementById('machineLabelPreviewContainer');
    const previewImg = document.getElementById('machineLabelPreviewImg');
    const removeBtn = document.getElementById('removeMachineLabelBtn');
    const ocrStatus = document.getElementById('ocrStatus');
    const extractedDataDiv = document.getElementById('extractedData');
    const extractedDataContent = document.getElementById('extractedDataContent');
    
    if (!fileInput || !uploadBtn) {
        console.error('Machine label upload elements not found:', { fileInput: !!fileInput, uploadBtn: !!uploadBtn });
        return;
    }
    
    if (!previewContainer || !previewImg) {
        console.error('Machine label preview elements not found');
        return;
    }
    
    console.log('Machine label upload elements found, setting up event listeners');
    
    // Upload button click - use both click and mousedown to ensure it works
    uploadBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Upload button clicked - machine label');
        try {
            if (fileInput) {
                fileInput.click();
            } else {
                console.error('File input not found');
            }
        } catch (error) {
            console.error('Error clicking file input:', error);
            alert('Error opening file dialog. Please check console for details.');
        }
        return false;
    });
    
    // Also try mousedown as fallback
    uploadBtn.addEventListener('mousedown', function(e) {
        e.preventDefault();
        console.log('Upload button mousedown - machine label');
    });
    
    // File input change
    fileInput.addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (!file) {
            console.log('No file selected');
            return;
        }
        
        console.log('File selected:', file.name, file.type);
        
        if (!file.type.startsWith('image/')) {
            showToast('Please select an image file', 'error');
            fileInput.value = '';
            return;
        }
        
        // Show preview
        const reader = new FileReader();
        reader.onerror = function(error) {
            console.error('FileReader error:', error);
            showToast('Error reading image file', 'error');
        };
        reader.onload = function(e) {
            try {
                currentMachineLabelPhoto = e.target.result;
                previewImg.src = e.target.result;
                previewContainer.style.display = 'block';
                if (ocrStatus) {
                    ocrStatus.textContent = 'Processing image...';
                    ocrStatus.style.color = 'var(--primary-color)';
                }
                if (extractedDataDiv) {
                    extractedDataDiv.style.display = 'none';
                }
                
                // Process OCR
                if (typeof processMachineLabelOCR === 'function') {
                    processMachineLabelOCR(e.target.result);
                } else {
                    console.error('processMachineLabelOCR function not found');
                    if (ocrStatus) {
                        ocrStatus.textContent = 'OCR function not available';
                        ocrStatus.style.color = 'var(--danger-color)';
                    }
                }
            } catch (error) {
                console.error('Error processing image:', error);
                showToast('Error processing image: ' + error.message, 'error');
            }
        };
        reader.readAsDataURL(file);
    });
    
    // Remove button
    if (removeBtn) {
        removeBtn.addEventListener('click', function() {
            currentMachineLabelPhoto = null;
            previewContainer.style.display = 'none';
            fileInput.value = '';
            extractedDataDiv.style.display = 'none';
            ocrStatus.textContent = '';
        });
    }
}

// Process OCR on machine label image
async function processMachineLabelOCR(imageDataUrl) {
    // Load OCR library on demand
    if (typeof window.loadOCRLibrary === 'function') {
        await window.loadOCRLibrary();
    }
    
    const ocrStatus = document.getElementById('ocrStatus');
    const extractedDataDiv = document.getElementById('extractedData');
    const extractedDataContent = document.getElementById('extractedDataContent');
    
    try {
        ocrStatus.textContent = 'Extracting text from image...';
        ocrStatus.style.color = 'var(--primary-color)';
        
        // Check if Tesseract is available
        if (typeof Tesseract === 'undefined') {
            throw new Error('OCR library not loaded. Please refresh the page.');
        }
        
        // Perform OCR
        const { data: { text } } = await Tesseract.recognize(imageDataUrl, 'eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    ocrStatus.textContent = `Recognizing text... ${Math.round(m.progress * 100)}%`;
                }
            }
        });
        
        ocrStatus.textContent = 'Text extracted successfully!';
        ocrStatus.style.color = 'var(--success-color)';
        
        // Parse and extract machine data
        const extractedData = parseMachineLabelText(text);
        
        // Display extracted data
        if (extractedData.found.length > 0) {
            let html = '<ul style="margin: 5px 0; padding-left: 20px;">';
            extractedData.found.forEach(item => {
                html += `<li><strong>${item.field}:</strong> ${item.value}</li>`;
            });
            html += '</ul>';
            extractedDataContent.innerHTML = html;
            extractedDataDiv.style.display = 'block';
            
            // Auto-populate form fields
            populateMachineFields(extractedData);
            
            showToast(`Extracted ${extractedData.found.length} machine parameter(s)`, 'success');
        } else {
            extractedDataContent.innerHTML = '<p style="color: var(--text-secondary); margin: 5px 0;">No machine parameters detected. You can manually enter the data.</p>';
            extractedDataDiv.style.display = 'block';
            showToast('No machine parameters found in image. Please enter manually.', 'info');
        }
        
        // Show raw text for debugging (optional)
        console.log('OCR Raw Text:', text);
        console.log('Extracted Data:', extractedData);
        
    } catch (error) {
        console.error('OCR Error:', error);
        ocrStatus.textContent = `Error: ${error.message}`;
        ocrStatus.style.color = 'var(--danger-color)';
        showToast(`OCR Error: ${error.message}`, 'error');
    }
}

// Parse machine label text to extract parameters
function parseMachineLabelText(text) {
    const extracted = {
        found: [],
        raw: text
    };
    
    // Normalize text
    const normalizedText = text.toUpperCase().replace(/\s+/g, ' ');
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    // Common machine parameter patterns
    const patterns = {
        machineName: [
            /(?:MACHINE|MODEL|TYPE|NAME)[\s:]+([A-Z0-9\-\.]+)/i,
            /([A-Z]{2,}\s*[0-9]+[A-Z0-9\-\.]*)/, // e.g., "HAAS VF2", "DMU 50"
            /(?:CNC|MILL|LATHE|MACHINING\s+CENTER)[\s:]+([A-Z0-9\-\.]+)/i
        ],
        serialNumber: [
            /(?:SERIAL|S\/N|SN)[\s:]+([A-Z0-9\-]+)/i,
            /S\/N[\s:]*([A-Z0-9\-]+)/i
        ],
        maxSpindleSpeed: [
            /(?:MAX|MAXIMUM)[\s]*(?:SPINDLE|RPM|SPEED)[\s:]+([0-9,]+)/i,
            /(?:SPINDLE|RPM)[\s:]+([0-9,]+)[\s]*(?:RPM|MAX)/i,
            /([0-9,]+)[\s]*RPM/i
        ],
        maxFeedRate: [
            /(?:MAX|MAXIMUM)[\s]*(?:FEED|FEEDRATE)[\s:]+([0-9,]+\.?[0-9]*)/i,
            /(?:FEED|FEEDRATE)[\s:]+([0-9,]+\.?[0-9]*)[\s]*(?:MM\/MIN|IPM)/i
        ],
        power: [
            /(?:POWER|HP|KW|KILOWATT)[\s:]+([0-9,]+\.?[0-9]*)/i,
            /([0-9,]+\.?[0-9]*)[\s]*(?:KW|HP|KILOWATT)/i
        ],
        workArea: [
            /(?:WORK|TRAVEL|X|Y|Z)[\s]*(?:AREA|SIZE|DIMENSION)[\s:]+([0-9,]+\.?[0-9]*)/i,
            /X[\s:]+([0-9,]+)[\s]*Y[\s:]+([0-9,]+)[\s]*Z[\s:]+([0-9,]+)/i
        ],
        year: [
            /(?:YEAR|Y\.)[\s:]+([0-9]{4})/i,
            /([0-9]{4})[\s]*(?:YEAR|Y\.)/i
        ]
    };
    
    // Try to extract machine name (most important)
    for (const pattern of patterns.machineName) {
        const match = normalizedText.match(pattern);
        if (match && match[1]) {
            const value = match[1].trim();
            if (value.length > 2 && !extracted.found.find(f => f.field === 'Machine Name')) {
                extracted.found.push({ field: 'Machine Name', value: value });
                document.getElementById('machineName').value = value;
            }
        }
    }
    
    // Extract serial number
    for (const pattern of patterns.serialNumber) {
        const match = normalizedText.match(pattern);
        if (match && match[1]) {
            extracted.found.push({ field: 'Serial Number', value: match[1].trim() });
            break;
        }
    }
    
    // Extract max spindle speed
    for (const pattern of patterns.maxSpindleSpeed) {
        const match = normalizedText.match(pattern);
        if (match && match[1]) {
            const rpm = parseInt(match[1].replace(/,/g, ''));
            if (rpm > 0 && rpm < 100000) {
                extracted.found.push({ field: 'Max Spindle Speed', value: `${rpm} RPM` });
                break;
            }
        }
    }
    
    // Extract max feed rate
    for (const pattern of patterns.maxFeedRate) {
        const match = normalizedText.match(pattern);
        if (match && match[1]) {
            const feed = parseFloat(match[1].replace(/,/g, ''));
            if (feed > 0 && feed < 100000) {
                extracted.found.push({ field: 'Max Feed Rate', value: `${feed} mm/min` });
                break;
            }
        }
    }
    
    // Extract power
    for (const pattern of patterns.power) {
        const match = normalizedText.match(pattern);
        if (match && match[1]) {
            const power = parseFloat(match[1].replace(/,/g, ''));
            if (power > 0 && power < 1000) {
                extracted.found.push({ field: 'Power', value: `${power} kW` });
                break;
            }
        }
    }
    
    // Extract work area dimensions
    const workAreaMatch = normalizedText.match(/X[\s:]+([0-9,]+)[\s]*Y[\s:]+([0-9,]+)[\s]*Z[\s:]+([0-9,]+)/i);
    if (workAreaMatch) {
        const x = workAreaMatch[1].replace(/,/g, '');
        const y = workAreaMatch[2].replace(/,/g, '');
        const z = workAreaMatch[3].replace(/,/g, '');
        extracted.found.push({ field: 'Work Area', value: `X: ${x}mm × Y: ${y}mm × Z: ${z}mm` });
    }
    
    // Extract year
    for (const pattern of patterns.year) {
        const match = normalizedText.match(pattern);
        if (match && match[1]) {
            const year = parseInt(match[1]);
            if (year >= 1950 && year <= new Date().getFullYear() + 1) {
                extracted.found.push({ field: 'Year', value: year.toString() });
                break;
            }
        }
    }
    
    return extracted;
}

// Populate machine-related form fields
function populateMachineFields(extractedData) {
    // Machine name is already populated in parseMachineLabelText
    // Add any additional field mappings here if needed
    
    // You can extend this to populate other fields based on extracted data
    // For example, if power is extracted, you might want to store it somewhere
    // or if max spindle speed is found, it could inform cutting speed recommendations
}

// Photo upload and crop functions
async function initializePhotoUpload() {
    console.log('Initializing tool photo upload...');
    // Load photo libraries on demand
    if (typeof window.loadPhotoLibraries === 'function') {
        await window.loadPhotoLibraries();
    }
    const fileInput = document.getElementById('toolPhoto');
    const uploadBtn = document.getElementById('uploadPhotoBtn');
    const photoPreviewContainer = document.getElementById('photoPreviewContainer');
    const photoPreviewImg = document.getElementById('photoPreviewImg');
    const cropModal = document.getElementById('cropModal');
    const cropImage = document.getElementById('cropImage');
    const cropContainer = document.getElementById('cropContainer');
    
    if (!fileInput || !uploadBtn) {
        console.error('Tool photo upload elements not found:', {
            fileInput: !!fileInput,
            uploadBtn: !!uploadBtn
        });
        return;
    }
    
    if (!photoPreviewContainer || !photoPreviewImg) {
        console.error('Tool photo preview elements not found');
        return;
    }
    
    console.log('Tool photo upload elements found, setting up event listeners');
    
    // Upload button click
    uploadBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Upload button clicked - tool photo');
        try {
            if (fileInput) {
                fileInput.click();
            } else {
                console.error('File input not found');
                alert('File input not found. Please refresh the page.');
            }
        } catch (error) {
            console.error('Error clicking file input:', error);
            alert('Error opening file dialog: ' + error.message);
        }
        return false;
    });
    
    // File input change
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        console.log('Tool photo file selected:', file ? file.name : 'none');
        if (file) {
            try {
                if (typeof handlePhotoUpload === 'function') {
                    handlePhotoUpload(file);
                } else {
                    console.error('handlePhotoUpload function not found');
                    alert('Photo upload function not available. Please refresh the page.');
                }
            } catch (error) {
                console.error('Error handling photo upload:', error);
                alert('Error uploading photo: ' + error.message);
            }
        }
    });
    
    // Remove photo
    const removePhotoBtn = document.getElementById('removePhotoBtn');
    if (removePhotoBtn) {
        removePhotoBtn.addEventListener('click', function() {
            currentToolPhoto = null;
            currentPhotoDate = null;
            if (fileInput) {
                fileInput.value = '';
            }
            if (photoPreviewContainer) {
                photoPreviewContainer.style.display = 'none';
            }
        });
    }
    
    // Crop photo button
    const cropPhotoBtn = document.getElementById('cropPhotoBtn');
    if (cropPhotoBtn) {
        cropPhotoBtn.addEventListener('click', function() {
            if (currentToolPhoto) {
                if (typeof openCropModal === 'function') {
                    openCropModal();
                } else {
                    console.error('openCropModal function not found');
                }
            }
        });
    }
    
    // Close crop modal
    const closeCropModalBtn = document.getElementById('closeCropModal');
    if (closeCropModalBtn) {
        closeCropModalBtn.addEventListener('click', function() {
            if (typeof closeCropModal === 'function') {
                closeCropModal();
            }
        });
    }
    
    const cancelCropBtn = document.getElementById('cancelCropBtn');
    if (cancelCropBtn) {
        cancelCropBtn.addEventListener('click', function() {
            if (typeof closeCropModal === 'function') {
                closeCropModal();
            }
        });
    }
    
    // Apply crop
    const applyCropBtn = document.getElementById('applyCropBtn');
    if (applyCropBtn) {
        applyCropBtn.addEventListener('click', function() {
            if (cropperInstance) {
                try {
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
                            if (photoPreviewImg) {
                                photoPreviewImg.src = currentToolPhoto;
                            }
                            if (typeof closeCropModal === 'function') {
                                closeCropModal();
                            }
                        };
                        reader.readAsDataURL(blob);
                    }, 'image/jpeg', 0.9);
                } catch (error) {
                    console.error('Error applying crop:', error);
                    alert('Error applying crop: ' + error.message);
                }
            }
        });
    }
    
    // Close modal on outside click
    if (cropModal) {
        cropModal.addEventListener('click', function(e) {
            if (e.target === cropModal) {
                if (typeof closeCropModal === 'function') {
                    closeCropModal();
                }
            }
        });
    }
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
async function initializeCatalogueImport() {
    console.log('Initializing catalogue import...');
    // Load catalogue libraries on demand
    if (typeof window.loadCatalogueLibraries === 'function') {
        await window.loadCatalogueLibraries();
    }
    const fileInput = document.getElementById('catalogueFile');
    const importBtn = document.getElementById('importCatalogueBtn');
    const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
    const importModal = document.getElementById('catalogueImportModal');
    const closeImportBtn = document.getElementById('closeImportModal');
    const cancelImportBtn = document.getElementById('cancelImportBtn');
    const applyMappingBtn = document.getElementById('applyMappingBtn');
    const importSelectedBtn = document.getElementById('importSelectedBtn');
    
    if (!fileInput || !importBtn || !downloadTemplateBtn) {
        console.error('Catalogue import elements not found:', {
            fileInput: !!fileInput,
            importBtn: !!importBtn,
            downloadTemplateBtn: !!downloadTemplateBtn
        });
        return;
    }
    
    console.log('Catalogue import elements found, setting up event listeners');
    
    // Import button click
    importBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Import button clicked');
        try {
            if (fileInput) {
                fileInput.click();
            } else {
                console.error('File input not found');
                alert('File input not found. Please refresh the page.');
            }
        } catch (error) {
            console.error('Error clicking file input:', error);
            alert('Error opening file dialog: ' + error.message);
        }
        return false;
    });
    
    // Download template
    downloadTemplateBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Download template button clicked');
        try {
            if (typeof downloadCatalogueTemplate === 'function') {
                downloadCatalogueTemplate();
            } else {
                console.error('downloadCatalogueTemplate function not found');
                alert('Template download function not available. Please refresh the page.');
            }
        } catch (error) {
            console.error('Error downloading template:', error);
            alert('Error downloading template: ' + error.message);
        }
        return false;
    });
    
    // File input change
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        console.log('Catalogue file selected:', file ? file.name : 'none');
        if (file) {
            try {
                if (typeof handleCatalogueImport === 'function') {
                    handleCatalogueImport(file);
                } else {
                    console.error('handleCatalogueImport function not found');
                    alert('Import function not available. Please refresh the page.');
                }
            } catch (error) {
                console.error('Error handling catalogue import:', error);
                alert('Error importing catalogue: ' + error.message);
            }
        }
    });
    
    // Close modal
    if (closeImportBtn) {
        closeImportBtn.addEventListener('click', function() {
            if (typeof closeImportModal === 'function') {
                closeImportModal();
            }
        });
    }
    if (cancelImportBtn) {
        cancelImportBtn.addEventListener('click', function() {
            if (typeof closeImportModal === 'function') {
                closeImportModal();
            }
        });
    }
    if (importModal) {
        importModal.addEventListener('click', function(e) {
            if (e.target === importModal) {
                if (typeof closeImportModal === 'function') {
                    closeImportModal();
                }
            }
        });
    }
    
    // Apply mapping
    if (applyMappingBtn) {
        applyMappingBtn.addEventListener('click', function() {
            if (typeof applyFieldMapping === 'function') {
                applyFieldMapping();
            } else {
                console.error('applyFieldMapping function not found');
            }
        });
    }
    
    // Import selected tools
    if (importSelectedBtn) {
        importSelectedBtn.addEventListener('click', function() {
            if (typeof importSelectedTools === 'function') {
                importSelectedTools();
            } else {
                console.error('importSelectedTools function not found');
            }
        });
    }
}

function downloadCatalogueTemplate() {
    if (typeof Papa === 'undefined') {
        console.error('PapaParse library not loaded');
        alert('CSV library not loaded. Please refresh the page.');
        return;
    }
    
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
    
    try {
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
        URL.revokeObjectURL(url);
        console.log('Template downloaded successfully');
    } catch (error) {
        console.error('Error downloading template:', error);
        alert('Error downloading template: ' + error.message);
    }
}

function handleCatalogueImport(file) {
    console.log('Handling catalogue import for file:', file.name);
    const fileName = file.name.toLowerCase();
    const importModal = document.getElementById('catalogueImportModal');
    const importStatus = document.getElementById('importStatus');
    
    if (!importModal || !importStatus) {
        console.error('Import modal elements not found');
        alert('Import modal not found. Please refresh the page.');
        return;
    }
    
    importModal.style.display = 'block';
    importStatus.innerHTML = '<p style="color: var(--primary-color);">Processing catalogue file...</p>';
    
    if (fileName.endsWith('.csv')) {
        if (typeof Papa === 'undefined') {
            importStatus.innerHTML = '<p style="color: var(--danger-color);">CSV parsing library not loaded. Please refresh the page.</p>';
            console.error('PapaParse library not loaded');
            return;
        }
        
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
        if (typeof XLSX === 'undefined') {
            importStatus.innerHTML = '<p style="color: var(--danger-color);">Excel parsing library not loaded. Please refresh the page.</p>';
            console.error('XLSX library not loaded');
            return;
        }
        
        const reader = new FileReader();
        reader.onerror = function(error) {
            console.error('FileReader error:', error);
            importStatus.innerHTML = `<p style="color: var(--danger-color);">Error reading Excel file: ${error.message || 'Unknown error'}</p>`;
        };
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                    throw new Error('Excel file has no sheets');
                }
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                const fields = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
                handleParsedData(jsonData, fields);
            } catch (error) {
                console.error('Error parsing Excel:', error);
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
    updateComparisonTable().catch(error => console.error('Error updating comparison table:', error));
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
    
    if (!generateReportBtn || !reportModal) {
        console.error('Report generation elements not found');
        return;
    }
    
    if (generateReportBtn) {
        generateReportBtn.addEventListener('click', function() {
            if (reportModal) {
                reportModal.style.display = 'block';
            }
        });
    }
    
    if (closeReportBtn) {
        closeReportBtn.addEventListener('click', function() {
            if (typeof closeReportModal === 'function') {
                closeReportModal();
            }
        });
    }
    
    if (cancelReportBtn) {
        cancelReportBtn.addEventListener('click', function() {
            if (typeof closeReportModal === 'function') {
                closeReportModal();
            }
        });
    }
    
    if (reportModal) {
        reportModal.addEventListener('click', function(e) {
            if (e.target === reportModal) {
                if (typeof closeReportModal === 'function') {
                    closeReportModal();
                }
            }
        });
    }
    
    if (sendReportBtn) {
        sendReportBtn.addEventListener('click', function() {
            if (typeof sendReportByEmail === 'function') {
                sendReportByEmail();
            } else {
                console.error('sendReportByEmail function not found');
            }
        });
    }
    
    if (downloadReportBtn) {
        downloadReportBtn.addEventListener('click', function() {
            if (typeof downloadReportPDF === 'function') {
                downloadReportPDF();
            } else {
                console.error('downloadReportPDF function not found');
            }
        });
    }
    
    // Initialize EmailJS (you'll need to set up EmailJS service)
    // For now, we'll use a fallback method
}

function closeReportModal() {
    document.getElementById('reportModal').style.display = 'none';
    document.getElementById('reportStatus').innerHTML = '';
}

// Get chart image as data URL
function getChartImage(chartInstance) {
    if (!chartInstance) return null;
    try {
        return chartInstance.toBase64Image('image/png', 1.0);
    } catch (error) {
        console.error('Error getting chart image:', error);
        return null;
    }
}

// Get HTML for main charts (tool life and cost savings)
function getChartImagesHTML() {
    let html = '';
    
    // Tool Life Chart
    if (toolLifeChartInstance) {
        const chartImage = getChartImage(toolLifeChartInstance);
        if (chartImage) {
            html += `
                <div style="margin: 15px 0;">
                    <h3>Tool Life Visualization</h3>
                    <img src="${chartImage}" alt="Tool Life Chart" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                </div>
            `;
        }
    }
    
    // Cost Savings Chart
    if (costSavingsChartInstance) {
        const chartImage = getChartImage(costSavingsChartInstance);
        if (chartImage) {
            html += `
                <div style="margin: 15px 0;">
                    <h3>Cost Breakdown</h3>
                    <img src="${chartImage}" alt="Cost Savings Chart" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                </div>
            `;
        }
    }
    
    return html || '<p style="color: #64748b; font-style: italic;">Charts will be available after calculation.</p>';
}

// Get HTML for comparison charts
function getComparisonChartImagesHTML() {
    let html = '';
    
    // Tool Life Comparison Chart
    if (comparisonToolLifeChartInstance) {
        const chartImage = getChartImage(comparisonToolLifeChartInstance);
        if (chartImage) {
            html += `
                <div style="margin: 15px 0;">
                    <h3>Tool Life Comparison</h3>
                    <img src="${chartImage}" alt="Tool Life Comparison Chart" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                </div>
            `;
        }
    }
    
    // Cost Comparison Chart
    if (comparisonCostChartInstance) {
        const chartImage = getChartImage(comparisonCostChartInstance);
        if (chartImage) {
            html += `
                <div style="margin: 15px 0;">
                    <h3>Cost per Part Comparison</h3>
                    <img src="${chartImage}" alt="Cost Comparison Chart" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                </div>
            `;
        }
    }
    
    // Efficiency Metrics Chart
    if (comparisonEfficiencyChartInstance) {
        const chartImage = getChartImage(comparisonEfficiencyChartInstance);
        if (chartImage) {
            html += `
                <div style="margin: 15px 0;">
                    <h3>Efficiency Metrics</h3>
                    <img src="${chartImage}" alt="Efficiency Metrics Chart" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                </div>
            `;
        }
    }
    
    return html || '<p style="color: #64748b; font-style: italic;">Comparison charts will be available when comparing tools.</p>';
}

function generateReportHTML() {
    const params = getInputValues();
    const toolLife = params.toolLife || calculateToolLife(params);
    const costResults = calculateCostPerPart({ ...params, toolLife });
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
    const recommendations = getRecommendations(params, costResults);
    const oeeResults = calculateOEE(params, costResults, toolLife);
    
    const includeCharts = document.getElementById('includeCharts').checked;
    const includeComparison = document.getElementById('includeComparison').checked;
    
    // Calculate processing time
    const machiningTime = params.machiningTime !== null && params.machiningTime !== undefined 
        ? params.machiningTime 
        : (params.processingTime + (params.toolChangeTime || 0));
    
    const reportDate = new Date();
    const reportNumber = `RPT-${reportDate.getFullYear()}-${String(reportDate.getMonth() + 1).padStart(2, '0')}-${String(Date.now()).slice(-6)}`;
    
    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>CNC Tool Selection Analysis Report</title>
            <style>
                @page {
                    margin: 2.5cm;
                    @bottom-right {
                        content: "Page " counter(page) " of " counter(pages);
                        font-size: 9pt;
                        color: #666;
                    }
                }
                body { 
                    font-family: 'Times New Roman', 'Georgia', serif; 
                    padding: 0;
                    margin: 0;
                    color: #1a1a1a; 
                    line-height: 1.7;
                    font-size: 11pt;
                    background: #ffffff;
                }
                .header {
                    border-bottom: 3px solid #2c3e50;
                    padding-bottom: 20px;
                    margin-bottom: 30px;
                    page-break-after: avoid;
                }
                .header-top {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 15px;
                }
                .company-info {
                    flex: 1;
                }
                .company-name {
                    font-size: 18pt;
                    font-weight: bold;
                    color: #2c3e50;
                    margin-bottom: 5px;
                    letter-spacing: 0.5px;
                }
                .company-details {
                    font-size: 9pt;
                    color: #555;
                    line-height: 1.5;
                }
                .report-info {
                    text-align: right;
                    flex: 1;
                }
                .report-title {
                    font-size: 24pt;
                    font-weight: bold;
                    color: #2c3e50;
                    margin-bottom: 10px;
                    text-align: center;
                    letter-spacing: 1px;
                    margin-top: 20px;
                }
                .report-subtitle {
                    font-size: 12pt;
                    color: #555;
                    text-align: center;
                    font-style: italic;
                    margin-bottom: 20px;
                }
                .report-meta {
                    display: flex;
                    justify-content: space-between;
                    font-size: 9pt;
                    color: #666;
                    margin-top: 15px;
                    padding-top: 15px;
                    border-top: 1px solid #ddd;
                }
                h1 { 
                    color: #2c3e50; 
                    border-bottom: 2px solid #34495e; 
                    padding-bottom: 8px; 
                    margin-top: 35px;
                    margin-bottom: 20px;
                    font-size: 16pt;
                    font-weight: bold;
                    page-break-after: avoid;
                }
                h2 { 
                    color: #34495e; 
                    margin-top: 25px; 
                    margin-bottom: 15px;
                    border-bottom: 1px solid #bdc3c7; 
                    padding-bottom: 6px; 
                    font-size: 14pt;
                    font-weight: bold;
                    page-break-after: avoid;
                }
                h3 { 
                    color: #555; 
                    margin-top: 20px; 
                    font-size: 12pt;
                    font-weight: bold;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    margin: 20px 0;
                    page-break-inside: avoid;
                    font-size: 10pt;
                }
                th, td { 
                    border: 1px solid #bdc3c7; 
                    padding: 10px 12px; 
                    text-align: left; 
                }
                th { 
                    background-color: #34495e; 
                    color: #ffffff;
                    font-weight: bold;
                    font-size: 10pt;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                td {
                    background-color: #ffffff;
                }
                tr:nth-child(even) td {
                    background-color: #f8f9fa;
                }
                .highlight { 
                    background-color: #fff3cd !important; 
                    font-weight: 600; 
                }
                .section { 
                    margin: 25px 0; 
                    padding: 0;
                    background-color: transparent;
                    page-break-inside: avoid;
                }
                .value { 
                    font-size: 12pt; 
                    font-weight: 700; 
                    color: #2c3e50; 
                }
                .formula { 
                    font-family: 'Courier New', monospace; 
                    background: #f8f9fa; 
                    padding: 12px 15px; 
                    border-left: 4px solid #34495e;
                    margin: 10px 0;
                    font-size: 10pt;
                    border-radius: 0;
                }
                .recommendation { 
                    background: #e8f5e9; 
                    padding: 12px 15px; 
                    margin: 10px 0; 
                    border-left: 4px solid #4caf50;
                    border-radius: 0;
                    font-size: 10pt;
                }
                .footer { 
                    margin-top: 50px; 
                    padding-top: 20px; 
                    border-top: 2px solid #bdc3c7; 
                    font-size: 9pt; 
                    color: #666;
                    text-align: center;
                    page-break-inside: avoid;
                }
                .footer-line {
                    margin: 5px 0;
                }
                .photo-info { 
                    margin: 15px 0; 
                }
                .photo-info img { 
                    max-width: 300px; 
                    max-height: 300px; 
                    border: 2px solid #bdc3c7;
                    border-radius: 0;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .chart-image { 
                    max-width: 100%; 
                    height: auto; 
                    border: 1px solid #bdc3c7; 
                    border-radius: 0;
                    margin: 15px 0;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .page-break {
                    page-break-before: always;
                }
                .no-break {
                    page-break-inside: avoid;
                }
                .confidential {
                    font-size: 8pt;
                    color: #c0392b;
                    font-weight: bold;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="header-top">
                    <div class="company-info">
                        <div class="company-name">VENTEN OÜ</div>
                        <div class="company-details">
                            CNC Tool Selection & Analysis<br>
                            ISO 8688-2:1989 Compliant<br>
                            https://www.venten.ee/
                        </div>
                    </div>
                    <div class="report-info">
                        <div><strong>Report No:</strong> ${reportNumber}</div>
                        <div><strong>Date:</strong> ${reportDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                        <div><strong>Time:</strong> ${reportDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                </div>
                <div class="report-title">CNC TOOL SELECTION ANALYSIS REPORT</div>
                <div class="report-subtitle">Technical Evaluation Based on ISO 8688-2:1989 Standard</div>
                <div class="report-meta">
                    <div><strong>Standard Reference:</strong> ISO 8688-2:1989 - Tool life testing in milling Part 2: End milling</div>
                    <div class="confidential">CONFIDENTIAL</div>
                </div>
            </div>
            
            <div class="section">
                <h2>Project Information</h2>
                <table>
                    ${params.clientName ? `<tr><th>Client Name</th><td>${params.clientName}</td></tr>` : ''}
                    ${params.projectName ? `<tr><th>Project Name</th><td>${params.projectName}</td></tr>` : ''}
                    ${params.partName ? `<tr><th>Part/Detail Name</th><td>${params.partName}</td></tr>` : ''}
                    ${params.machineName ? `<tr><th>Machine Name</th><td>${params.machineName}</td></tr>` : ''}
                    ${params.applicationType ? `<tr><th>Application Type</th><td>${params.applicationType}</td></tr>` : ''}
                    ${params.customerContact ? `<tr><th>Customer Contact Person</th><td>${params.customerContact}</td></tr>` : ''}
                    ${params.expertName ? `<tr><th>Our Expert Name</th><td>${params.expertName}</td></tr>` : ''}
                    ${params.batchSize > 1 ? `<tr><th>Batch/Lot Size</th><td>${params.batchSize} parts</td></tr>` : ''}
                    ${params.theoreticalPartWorktime ? `<tr><th>Theoretical Part Worktime</th><td>${params.theoreticalPartWorktime} min</td></tr>` : ''}
                    ${params.machineWorkhourCost ? `<tr><th>Machine Workhour Cost</th><td>${formatCurrency(params.machineWorkhourCost)}/hour</td></tr>` : ''}
                    ${params.machineStopCost ? `<tr><th>Machine Stop/Downtime Cost</th><td>${formatCurrency(params.machineStopCost)}/hour</td></tr>` : ''}
                </table>
            </div>
            
            ${params.partsPerBatch || params.partsPerYear || params.annualSolutions ? `
            <div class="section">
                <h2>Production & Cost Parameters</h2>
                <table>
                    ${params.partsPerBatch ? `<tr><th>Parts per Batch</th><td>${params.partsPerBatch}</td></tr>` : ''}
                    ${params.partsPerYear ? `<tr><th>Parts per Year</th><td>${params.partsPerYear}</td></tr>` : ''}
                    ${params.annualSolutions ? `<tr><th>Annual Solutions</th><td>${params.annualSolutions}</td></tr>` : ''}
                    ${params.machineCostPerHour ? `<tr><th>Machine Cost per Hour</th><td>${formatCurrency(params.machineCostPerHour)}/hour</td></tr>` : ''}
                    ${params.costOfToolChange ? `<tr><th>Cost of Tool Change</th><td>${formatCurrency(params.costOfToolChange)}</td></tr>` : ''}
                    ${params.timeLossPerToolChange ? `<tr><th>Time Loss per Tool Change</th><td>${params.timeLossPerToolChange} min</td></tr>` : ''}
                    ${params.machineStopDowntimeCost ? `<tr><th>Machine Stop/Downtime Cost</th><td>${formatCurrency(params.machineStopDowntimeCost)}/hour</td></tr>` : ''}
                </table>
            </div>
            ` : ''}
            
            <div class="section">
                <h2>Tool Information</h2>
                <table>
                    ${params.toolBrand ? `<tr><th>Brand</th><td>${params.toolBrand.charAt(0).toUpperCase() + params.toolBrand.slice(1)}</td></tr>` : ''}
                    ${params.toolType ? `<tr><th>Type</th><td>${params.toolType.replace(/([A-Z])/g, ' $1').trim()}</td></tr>` : ''}
                    ${params.toolNameModel ? `<tr><th>Name/Model</th><td>${params.toolNameModel}</td></tr>` : ''}
                    ${params.toolProductCode ? `<tr><th>Product Code</th><td>${params.toolProductCode}</td></tr>` : ''}
                    <tr><th>Tool Diameter (D)</th><td>${params.toolDiameter} mm</td></tr>
                    <tr><th>Number of Teeth/Flutes (Z)</th><td>${params.numberOfTeeth}</td></tr>
                    <tr><th>Tool Material</th><td>${params.toolMaterial}</td></tr>
                    <tr><th>Tool Coating</th><td>${params.toolCoating}</td></tr>
                    ${params.cuttingFluid && params.cuttingFluid !== 'none' ? `<tr><th>Cutting Fluid</th><td>${formatCuttingFluid(params.cuttingFluid)}</td></tr>` : ''}
                    ${params.helixAngle ? `<tr><th>Helix Angle (β)</th><td>${params.helixAngle}°</td></tr>` : ''}
                    ${params.rakeAngle ? `<tr><th>Rake Angle (γ)</th><td>${params.rakeAngle}°</td></tr>` : ''}
                    <tr><th>Tool Cost (C<sub>t</sub>)</th><td>${formatCurrency(params.toolCost)}</td></tr>
                    ${params.toolRemainingCost > 0 ? `<tr><th>Tool Residual Value (C<sub>r</sub>)</th><td>${formatCurrency(params.toolRemainingCost)}</td></tr>` : ''}
                    ${params.toolPhoto ? `
                    <tr><th>Tool Photo</th><td class="photo-info">
                        <img src="${params.toolPhoto}" alt="Tool Photo">
                        ${params.photoDate ? `<br><small>Photo Date: ${formatDate(params.photoDate)}</small>` : ''}
                    </td></tr>
                    ` : ''}
                </table>
            </div>
            
            <div class="section">
                <h2>Workpiece Material</h2>
                <table>
                    <tr><th>Material Type</th><td>${params.workpieceMaterial}</td></tr>
                    ${params.materialHardness ? `<tr><th>Material Hardness (HRC)</th><td>${params.materialHardness}</td></tr>` : ''}
                </table>
            </div>
            
            <div class="section">
                <h2>Cutting Parameters</h2>
                <table>
                    <tr><th>Cutting Speed (V<sub>c</sub>)</th><td>${params.cuttingSpeed} m/min</td></tr>
                    <tr><th>Feed per Tooth (f<sub>z</sub>)</th><td>${params.feedRate} mm/tooth</td></tr>
                    <tr><th>Axial Depth of Cut (a<sub>p</sub>)</th><td>${params.depthOfCut} mm</td></tr>
                    <tr><th>Radial Width of Cut (a<sub>e</sub>)</th><td>${params.widthOfCut} mm</td></tr>
                    ${params.cuttingFluid && params.cuttingFluid !== 'none' ? `<tr><th>Cutting Fluid</th><td>${formatCuttingFluid(params.cuttingFluid)}</td></tr>` : ''}
                </table>
            </div>
            
            <div class="section">
                <h2>Calculated Machining Parameters</h2>
                <table>
                    <tr><th>Spindle Speed (n)</th><td>${formatNumber(spindleSpeed, 'RPM')}</td></tr>
                    <tr><th>Feed Rate (V<sub>f</sub>)</th><td>${formatNumber(feedRateMM, 'mm/min')}</td></tr>
                    <tr><th>Feed per Revolution (f)</th><td>${formatNumber(feedPerRev, 'mm/rev')}</td></tr>
                    <tr><th>Material Removal Rate (Q)</th><td>${formatNumber(mrr, 'mm³/min')}</td></tr>
                    <tr><th>Chip Thickness (h)</th><td>${formatNumber(chipThickness, 'mm')}</td></tr>
                </table>
            </div>
            
            <div class="section">
                <h2>Cutting Forces & Power</h2>
                <table>
                    <tr><th>Specific Cutting Force (k<sub>c</sub>)</th><td>${formatNumber(specificCuttingForce, 'N/mm²')}</td></tr>
                    <tr><th>Cutting Force (F<sub>c</sub>)</th><td>${formatNumber(cuttingForce, 'N')}</td></tr>
                    <tr><th>Power Requirement (P)</th><td>${formatNumber(powerRequired, 'kW')}</td></tr>
                    <tr><th>Torque (M)</th><td>${formatNumber(torque, 'Nm')}</td></tr>
                    <tr><th>MRR per Power</th><td>${formatNumber(mrrPerPower, 'cm³/min/kW')}</td></tr>
                </table>
            </div>
            
            <div class="section">
                <h2>Surface Quality</h2>
                <table>
                    <tr><th>Surface Roughness (R<sub>a</sub>)</th><td>${formatNumber(surfaceFinish, 'μm')}</td></tr>
                </table>
            </div>
            
            <div class="section">
                <h2>Time Parameters</h2>
                <table>
                    ${params.processingTime ? `<tr><th>Processing Time - Cutting Time (t<sub>c</sub>)</th><td>${params.processingTime} min</td></tr>` : ''}
                    ${params.toolChangeTime ? `<tr><th>Tool Change Time</th><td>${params.toolChangeTime} min</td></tr>` : ''}
                    <tr><th>Total Machining Time per Part</th><td>${machiningTime} min</td></tr>
                    ${params.machineHourlyRate ? `<tr><th>Machine Hourly Rate</th><td>${formatCurrency(params.machineHourlyRate)}/hour</td></tr>` : ''}
                    ${params.toolChangeCost > 0 ? `<tr><th>Tool Change Cost</th><td>${formatCurrency(params.toolChangeCost)}</td></tr>` : ''}
                </table>
            </div>
            
            <div class="section">
                <h2>Cost Analysis</h2>
                <table>
                    <tr><th>Total Cost per Part</th><td class="value">${formatCurrency(costResults.totalCostPerPart)}</td></tr>
                    <tr><th>Tool Cost per Part</th><td>${formatCurrency(costResults.toolCostPerPart)}</td></tr>
                    ${costResults.processingCostPerPart ? `<tr><th>Processing (Cutting) Cost per Part</th><td>${formatCurrency(costResults.processingCostPerPart)}</td></tr>` : ''}
                    <tr><th>Machining Cost per Part</th><td>${formatCurrency(costResults.machiningCostPerPart)}</td></tr>
                    ${costResults.toolChangeCostPerPart > 0 ? `<tr><th>Tool Change Cost per Part</th><td>${formatCurrency(costResults.toolChangeCostPerPart)}</td></tr>` : ''}
                    ${params.batchSize > 1 ? `
                    <tr><th colspan="2" style="background: #e0f2fe; padding-top: 15px;">Batch Cost Analysis</th></tr>
                    <tr><th>Total Batch Cost (${params.batchSize} parts)</th><td class="value">${formatCurrency(costResults.totalBatchCost)}</td></tr>
                    <tr><th>Total Tool Cost for Batch</th><td>${formatCurrency(costResults.totalToolCostForBatch)}</td></tr>
                    <tr><th>Total Machining Cost for Batch</th><td>${formatCurrency(costResults.totalMachiningCostForBatch)}</td></tr>
                    ` : ''}
                </table>
            </div>
            
            <div class="section">
                <h2>Tool Life & Performance</h2>
                <table>
                    <tr><th>Estimated Tool Life (T)</th><td class="value">${toolLife} minutes</td></tr>
                    <tr><th>Parts per Tool Life</th><td>${costResults.partsPerToolLife} parts</td></tr>
                    ${costResults.toolChangesPerToolLife > 0 ? `<tr><th>Tool Changes per Tool Life</th><td>${costResults.toolChangesPerToolLife}</td></tr>` : ''}
                    <tr><th>Taylor's Constant (C)</th><td>${formatNumber(taylorConstant, '')}</td></tr>
                    <tr><th>Taylor Exponent (n)</th><td>0.2 (standard for end milling per ISO 8688-2)</td></tr>
                </table>
                <div class="formula" style="margin-top: 10px;">
                    V<sub>c</sub> × T<sup>n</sup> = C<br>
                    ${params.cuttingSpeed} × ${toolLife}<sup>0.2</sup> = ${formatNumber(taylorConstant, '')}
                </div>
            </div>
            
            <div class="section" style="background: #f0f9ff;">
                <h2>OEE Analysis (Overall Equipment Effectiveness)</h2>
                <table>
                    <tr><th>Overall OEE</th><td class="value" style="font-size: 1.5em; color: ${oeeResults.oee >= 85 ? '#10b981' : oeeResults.oee >= 60 ? '#f59e0b' : '#ef4444'};">
                        ${oeeResults.oee.toFixed(1)}%
                    </td></tr>
                    <tr><th colspan="2" style="background: #e0f2fe; padding-top: 15px;">OEE Components</th></tr>
                    <tr><th>Availability</th><td>${oeeResults.availability.toFixed(1)}% (Loss: ${oeeResults.availabilityLoss.toFixed(1)}%)</td></tr>
                    <tr><th>Performance</th><td>${oeeResults.performance.toFixed(1)}% (Loss: ${oeeResults.performanceLoss.toFixed(1)}%)</td></tr>
                    <tr><th>Quality</th><td>${oeeResults.quality.toFixed(1)}% (Defects: ${params.defectsRate || 2}%)</td></tr>
                    <tr><th colspan="2" style="background: #e0f2fe; padding-top: 15px;">OEE Impact Factors</th></tr>
                    <tr><th>Tool Change Impact</th><td>
                        Downtime: ${(oeeResults.toolChangeImpact.downtime * 60).toFixed(2)} min/part<br>
                        Frequency: ${(oeeResults.toolChangeImpact.frequency * 100).toFixed(2)}%<br>
                        Cost: ${formatCurrency(oeeResults.toolChangeImpact.cost)}/part<br>
                        Parts per tool life: ${oeeResults.partsPerToolLife}<br>
                        Tool changes per tool life: ${oeeResults.toolChangesPerToolLife}
                    </td></tr>
                    <tr><th>Speed Impact</th><td>
                        Cutting speed: ${params.cuttingSpeed} m/min<br>
                        ${oeeResults.speedImpact.toolLifeReduction > 0 ? `Tool life reduction: ${(oeeResults.speedImpact.toolLifeReduction * 100).toFixed(1)}%<br>` : ''}
                        ${oeeResults.speedImpact.performanceGain > 0 ? `Performance gain: ${(oeeResults.speedImpact.performanceGain * 100).toFixed(1)}%<br>` : ''}
                    </td></tr>
                    <tr><th>Tool Life Impact</th><td>
                        Tool life: ${toolLife} min<br>
                        Downtime from tool changes: ${(oeeResults.toolLifeImpact.downtime * 60).toFixed(2)} min/tool life<br>
                        Cost from tool changes: ${formatCurrency(oeeResults.toolLifeImpact.cost)}/part
                    </td></tr>
                    <tr><th>Machine Stop Impact</th><td>
                        Downtime per part: ${oeeResults.downtimePerPart.toFixed(2)} min<br>
                        Ideal cycle time: ${oeeResults.idealCycleTime.toFixed(2)} min<br>
                        Actual cycle time: ${oeeResults.actualCycleTime.toFixed(2)} min<br>
                        ${params.unplannedDowntime > 0 ? `Unplanned downtime: ${params.unplannedDowntime} hours/shift<br>` : ''}
                    </td></tr>
                    <tr><th>Defects Rate Impact</th><td>
                        Defects rate: ${params.defectsRate || 2}%<br>
                        Quality loss: ${oeeResults.qualityLoss.toFixed(1)}%
                    </td></tr>
                </table>
                <div class="formula" style="margin-top: 10px;">
                    OEE = Availability × Performance × Quality<br>
                    ${oeeResults.availability.toFixed(1)}% × ${oeeResults.performance.toFixed(1)}% × ${oeeResults.quality.toFixed(1)}% = ${oeeResults.oee.toFixed(1)}%
                </div>
            </div>
            
            ${recommendations.length > 0 ? `
            <div class="section">
                <h2>Engineering Recommendations</h2>
                ${recommendations.map(rec => `<div class="recommendation">${rec.message}</div>`).join('')}
            </div>
            ` : ''}
            
            ${includeCharts ? `
            <div class="section">
                <h2>📊 Charts & Visualizations</h2>
                ${getChartImagesHTML()}
            </div>
            ` : ''}
            
            <div class="section">
                <h2>Engineering Formulas Used</h2>
                <div class="formula">n = (V<sub>c</sub> × 1000) / (π × D)</div>
                <p><small>Spindle Speed: n = RPM, V<sub>c</sub> = cutting speed (m/min), D = tool diameter (mm)</small></p>
                
                <div class="formula">V<sub>f</sub> = f<sub>z</sub> × Z × n</div>
                <p><small>Feed Rate: V<sub>f</sub> = feed rate (mm/min), f<sub>z</sub> = feed per tooth (mm/tooth), Z = number of teeth</small></p>
                
                <div class="formula">Q = a<sub>e</sub> × a<sub>p</sub> × V<sub>f</sub></div>
                <p><small>Material Removal Rate: Q = MRR (mm³/min), a<sub>e</sub> = radial width (mm), a<sub>p</sub> = axial depth (mm)</small></p>
                
                <div class="formula">F<sub>c</sub> = k<sub>c</sub> × a<sub>p</sub> × a<sub>e</sub> × f<sub>z</sub></div>
                <p><small>Cutting Force: F<sub>c</sub> = cutting force (N), k<sub>c</sub> = specific cutting force (N/mm²)</small></p>
                
                <div class="formula">P = F<sub>c</sub> × V<sub>c</sub> / 60000</div>
                <p><small>Power Requirement: P = power (kW), F<sub>c</sub> = cutting force (N), V<sub>c</sub> = cutting speed (m/min)</small></p>
                
                <div class="formula">M = P × 9550 / n</div>
                <p><small>Torque: M = torque (Nm), P = power (kW), n = spindle speed (RPM)</small></p>
            </div>
    `;
    
    if (includeComparison && toolComparisons.length > 0) {
        // Find best and worst tools for savings
        const sortedByCost = [...toolComparisons].sort((a, b) => a.totalCostPerPart - b.totalCostPerPart);
        const bestTool = sortedByCost[0];
        const worstTool = sortedByCost[sortedByCost.length - 1];
        const costDifference = worstTool.totalCostPerPart - bestTool.totalCostPerPart;
        const costSavingsPercent = ((costDifference / worstTool.totalCostPerPart) * 100).toFixed(1);
        const batchSize = params.batchSize || 1;
        const savingsPerBatch = costDifference * batchSize;
        const savingsPer100Parts = costDifference * 100;
        
        html += `
            <div class="section">
                <h2>Tool Comparison</h2>
                <table>
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
            const isBest = tool.totalCostPerPart === bestTool.totalCostPerPart;
            html += `
                <tr ${isBest ? 'class="highlight"' : ''}>
                    <td>${tool.name}</td>
                    <td>${tool.toolBrand ? tool.toolBrand.charAt(0).toUpperCase() + tool.toolBrand.slice(1) : 'N/A'}</td>
                    <td>${tool.toolType ? tool.toolType.replace(/([A-Z])/g, ' $1').trim() : 'N/A'}</td>
                    <td>${tool.partName || 'N/A'}</td>
                    <td>${tool.toolMaterial || 'N/A'}</td>
                    <td>${tool.toolCoating || 'N/A'}</td>
                    <td ${isBest ? 'class="value"' : ''}>${formatCurrency(tool.totalCostPerPart)}</td>
                    <td>${tool.toolLife} min</td>
                    <td>${formatNumber(tool.mrr, 'mm³/min')}</td>
                    <td>${formatCurrency(tool.toolCost)}</td>
                </tr>
            `;
        });
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        if (toolComparisons.length >= 2) {
            html += `
                <div class="section">
                    <h2>Potential Savings Analysis</h2>
                    <table>
                        <tr><th>Best Tool (Lowest Cost)</th><td class="value">${bestTool.name}</td></tr>
                        <tr><th>Best Tool Cost per Part</th><td>${formatCurrency(bestTool.totalCostPerPart)}</td></tr>
                        <tr><th>Most Expensive Tool</th><td>${worstTool.name}</td></tr>
                        <tr><th>Most Expensive Tool Cost per Part</th><td>${formatCurrency(worstTool.totalCostPerPart)}</td></tr>
                        <tr><th colspan="2" style="background: #e0f2fe; padding-top: 15px;">Savings Potential</th></tr>
                        <tr><th>Savings per Part</th><td class="value">${formatCurrency(costDifference)} (${costSavingsPercent}% reduction)</td></tr>
                        ${batchSize > 1 ? `<tr><th>Savings per Batch (${batchSize} parts)</th><td class="value">${formatCurrency(savingsPerBatch)}</td></tr>` : ''}
                        <tr><th>Savings per 100 Parts</th><td class="value">${formatCurrency(savingsPer100Parts)}</td></tr>
                    </table>
                </div>
            `;
            
            if (includeCharts) {
                html += `
                    <div class="section">
                        <h2>📊 Comparison Charts</h2>
                        ${getComparisonChartImagesHTML()}
                    </div>
                `;
            }
        }
    }
    
    html += `
            <div class="footer">
                <div class="footer-line"><strong>VENTEN OÜ</strong> - CNC Tool Selection & Analysis</div>
                <div class="footer-line">Report No: ${reportNumber} | Generated: ${reportDate.toLocaleString()}</div>
                <div class="footer-line">ISO 8688-2:1989 - Tool life testing in milling Part 2: End milling</div>
                <div class="footer-line">https://www.venten.ee/ | laurisoosaar@gmail.com</div>
                <div class="footer-line" style="margin-top: 15px; font-size: 8pt; color: #999;">
                    This document contains confidential and proprietary information. Unauthorized disclosure is prohibited.
                </div>
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
    const oeeResults = calculateOEE(params, costResults, toolLife);
    
    const reportDate = new Date();
    const reportNumber = `RPT-${reportDate.getFullYear()}-${String(reportDate.getMonth() + 1).padStart(2, '0')}-${String(Date.now()).slice(-6)}`;
    
    let text = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                         VENTEN OÜ                                            ║
║              CNC TOOL SELECTION ANALYSIS REPORT                               ║
║         Technical Evaluation Based on ISO 8688-2:1989 Standard              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ Report No: ${reportNumber.padEnd(65)}║
║ Date: ${reportDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).padEnd(70)}║
║ Time: ${reportDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }).padEnd(71)}║
║ Standard: ISO 8688-2:1989 - Tool life testing in milling Part 2: End milling║
║ Classification: CONFIDENTIAL                                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝


═══════════════════════════════════════════════════════════════════════════════
1. PROJECT INFORMATION
═══════════════════════════════════════════════════════════════════════════════
${params.clientName ? `Client Name: ${params.clientName}\n` : ''}${params.projectName ? `Project Name: ${params.projectName}\n` : ''}${params.partName ? `Part/Detail Name: ${params.partName}\n` : ''}${params.machineName ? `Machine Name: ${params.machineName}\n` : ''}${params.applicationType ? `Application Type: ${params.applicationType}\n` : ''}${params.customerContact ? `Customer Contact: ${params.customerContact}\n` : ''}${params.expertName ? `Our Expert Name: ${params.expertName}\n` : ''}${params.batchSize > 1 ? `Batch/Lot Size: ${params.batchSize} parts\n` : ''}${params.theoreticalPartWorktime ? `Theoretical Part Worktime: ${params.theoreticalPartWorktime} min\n` : ''}${params.machineWorkhourCost ? `Machine Workhour Cost: ${formatCurrency(params.machineWorkhourCost)}/hour\n` : ''}${params.machineStopCost ? `Machine Stop/Downtime Cost: ${formatCurrency(params.machineStopCost)}/hour\n` : ''}
${params.partsPerBatch || params.partsPerYear || params.annualSolutions ? `
═══════════════════════════════════════════════════════════════
PRODUCTION & COST PARAMETERS
═══════════════════════════════════════════════════════════════
${params.partsPerBatch ? `Parts per Batch: ${params.partsPerBatch}\n` : ''}${params.partsPerYear ? `Parts per Year: ${params.partsPerYear}\n` : ''}${params.annualSolutions ? `Annual Solutions: ${params.annualSolutions}\n` : ''}${params.machineCostPerHour ? `Machine Cost per Hour: ${formatCurrency(params.machineCostPerHour)}/hour\n` : ''}${params.costOfToolChange ? `Cost of Tool Change: ${formatCurrency(params.costOfToolChange)}\n` : ''}${params.timeLossPerToolChange ? `Time Loss per Tool Change: ${params.timeLossPerToolChange} min\n` : ''}${params.machineStopDowntimeCost ? `Machine Stop/Downtime Cost: ${formatCurrency(params.machineStopDowntimeCost)}/hour\n` : ''}
` : ''}

═══════════════════════════════════════════════════════════════
TOOL INFORMATION
═══════════════════════════════════════════════════════════════
${params.toolBrand ? `Brand: ${params.toolBrand.charAt(0).toUpperCase() + params.toolBrand.slice(1)}\n` : ''}${params.toolType ? `Type: ${params.toolType.replace(/([A-Z])/g, ' $1').trim()}\n` : ''}${params.toolNameModel ? `Name/Model: ${params.toolNameModel}\n` : ''}${params.toolProductCode ? `Product Code: ${params.toolProductCode}\n` : ''}Tool Diameter (D): ${params.toolDiameter} mm
Number of Teeth/Flutes (Z): ${params.numberOfTeeth}
Tool Material: ${params.toolMaterial}
Tool Coating: ${params.toolCoating}
${params.cuttingFluid && params.cuttingFluid !== 'none' ? `Cutting Fluid: ${formatCuttingFluid(params.cuttingFluid)}\n` : ''}${params.helixAngle ? `Helix Angle (β): ${params.helixAngle}°\n` : ''}${params.rakeAngle ? `Rake Angle (γ): ${params.rakeAngle}°\n` : ''}Tool Cost (Ct): ${formatCurrency(params.toolCost)}
${params.toolRemainingCost > 0 ? `Tool Residual Value (Cr): ${formatCurrency(params.toolRemainingCost)}\n` : ''}${params.photoDate ? `Photo Date: ${formatDate(params.photoDate)}\n` : ''}

═══════════════════════════════════════════════════════════════
WORKPIECE MATERIAL
═══════════════════════════════════════════════════════════════
Material Type: ${params.workpieceMaterial}
${params.materialHardness ? `Material Hardness (HRC): ${params.materialHardness}\n` : ''}

═══════════════════════════════════════════════════════════════
CUTTING PARAMETERS
═══════════════════════════════════════════════════════════════
Cutting Speed (Vc): ${params.cuttingSpeed} m/min
Feed per Tooth (fz): ${params.feedRate} mm/tooth
Axial Depth of Cut (ap): ${params.depthOfCut} mm
Radial Width of Cut (ae): ${params.widthOfCut} mm
${params.cuttingFluid && params.cuttingFluid !== 'none' ? `Cutting Fluid: ${formatCuttingFluid(params.cuttingFluid)}\n` : ''}

═══════════════════════════════════════════════════════════════
CALCULATED MACHINING PARAMETERS
═══════════════════════════════════════════════════════════════
Spindle Speed (n): ${formatNumber(spindleSpeed, 'RPM')}
Feed Rate (Vf): ${formatNumber(feedRateMM, 'mm/min')}
Feed per Revolution (f): ${formatNumber(feedPerRev, 'mm/rev')}
Material Removal Rate (Q): ${formatNumber(mrr, 'mm³/min')}
Chip Thickness (h): ${formatNumber(chipThickness, 'mm')}

═══════════════════════════════════════════════════════════════
CUTTING FORCES & POWER
═══════════════════════════════════════════════════════════════
Specific Cutting Force (kc): ${formatNumber(specificCuttingForce, 'N/mm²')}
Cutting Force (Fc): ${formatNumber(cuttingForce, 'N')}
Power Requirement (P): ${formatNumber(powerRequired, 'kW')}
Torque (M): ${formatNumber(torque, 'Nm')}
MRR per Power: ${formatNumber(mrrPerPower, 'cm³/min/kW')}

═══════════════════════════════════════════════════════════════
SURFACE QUALITY
═══════════════════════════════════════════════════════════════
Surface Roughness (Ra): ${formatNumber(surfaceFinish, 'μm')}

═══════════════════════════════════════════════════════════════
TIME PARAMETERS
═══════════════════════════════════════════════════════════════
${params.processingTime ? `Processing Time - Cutting Time (tc): ${params.processingTime} min\n` : ''}${params.toolChangeTime ? `Tool Change Time: ${params.toolChangeTime} min\n` : ''}Total Machining Time per Part: ${params.machiningTime !== null && params.machiningTime !== undefined ? params.machiningTime : (params.processingTime + (params.toolChangeTime || 0))} min
${params.machineHourlyRate ? `Machine Hourly Rate: ${formatCurrency(params.machineHourlyRate)}/hour\n` : ''}${params.toolChangeCost > 0 ? `Tool Change Cost: ${formatCurrency(params.toolChangeCost)}\n` : ''}

═══════════════════════════════════════════════════════════════
COST ANALYSIS
═══════════════════════════════════════════════════════════════
Total Cost per Part: ${formatCurrency(costResults.totalCostPerPart)}
Tool Cost per Part: ${formatCurrency(costResults.toolCostPerPart)}
${costResults.processingCostPerPart ? `Processing (Cutting) Cost per Part: ${formatCurrency(costResults.processingCostPerPart)}\n` : ''}Machining Cost per Part: ${formatCurrency(costResults.machiningCostPerPart)}
${costResults.toolChangeCostPerPart > 0 ? `Tool Change Cost per Part: ${formatCurrency(costResults.toolChangeCostPerPart)}\n` : ''}${params.batchSize > 1 ? `
BATCH COST ANALYSIS (${params.batchSize} parts):
Total Batch Cost: ${formatCurrency(costResults.totalBatchCost)}
Total Tool Cost for Batch: ${formatCurrency(costResults.totalToolCostForBatch)}
Total Machining Cost for Batch: ${formatCurrency(costResults.totalMachiningCostForBatch)}
` : ''}

═══════════════════════════════════════════════════════════════
TOOL LIFE & PERFORMANCE
═══════════════════════════════════════════════════════════════
Estimated Tool Life (T): ${toolLife} minutes
Parts per Tool Life: ${costResults.partsPerToolLife} parts
${costResults.toolChangesPerToolLife > 0 ? `Tool Changes per Tool Life: ${costResults.toolChangesPerToolLife}\n` : ''}Taylor's Constant (C): ${formatNumber(taylorConstant, '')}
Taylor Exponent (n): 0.2 (standard for end milling per ISO 8688-2)
Taylor's Equation: Vc × T^n = C
                  ${params.cuttingSpeed} × ${toolLife}^0.2 = ${formatNumber(taylorConstant, '')}

═══════════════════════════════════════════════════════════════
OEE ANALYSIS (OVERALL EQUIPMENT EFFECTIVENESS)
═══════════════════════════════════════════════════════════════
Overall OEE: ${oeeResults.oee.toFixed(1)}%

OEE Components:
  Availability: ${oeeResults.availability.toFixed(1)}% (Loss: ${oeeResults.availabilityLoss.toFixed(1)}%)
  Performance: ${oeeResults.performance.toFixed(1)}% (Loss: ${oeeResults.performanceLoss.toFixed(1)}%)
  Quality: ${oeeResults.quality.toFixed(1)}% (Defects: ${params.defectsRate || 2}%)

OEE Impact Factors:
  Tool Change Impact:
    - Downtime: ${(oeeResults.toolChangeImpact.downtime * 60).toFixed(2)} min/part
    - Frequency: ${(oeeResults.toolChangeImpact.frequency * 100).toFixed(2)}%
    - Cost: ${formatCurrency(oeeResults.toolChangeImpact.cost)}/part
    - Parts per tool life: ${oeeResults.partsPerToolLife}
    - Tool changes per tool life: ${oeeResults.toolChangesPerToolLife}
  
  Speed Impact:
    - Cutting speed: ${params.cuttingSpeed} m/min
    ${oeeResults.speedImpact.toolLifeReduction > 0 ? `    - Tool life reduction: ${(oeeResults.speedImpact.toolLifeReduction * 100).toFixed(1)}%\n` : ''}    ${oeeResults.speedImpact.performanceGain > 0 ? `- Performance gain: ${(oeeResults.speedImpact.performanceGain * 100).toFixed(1)}%\n` : ''}
  
  Tool Life Impact:
    - Tool life: ${toolLife} min
    - Downtime from tool changes: ${(oeeResults.toolLifeImpact.downtime * 60).toFixed(2)} min/tool life
    - Cost from tool changes: ${formatCurrency(oeeResults.toolLifeImpact.cost)}/part
  
  Machine Stop Impact:
    - Downtime per part: ${oeeResults.downtimePerPart.toFixed(2)} min
    - Ideal cycle time: ${oeeResults.idealCycleTime.toFixed(2)} min
    - Actual cycle time: ${oeeResults.actualCycleTime.toFixed(2)} min
    ${params.unplannedDowntime > 0 ? `    - Unplanned downtime: ${params.unplannedDowntime} hours/shift\n` : ''}
  
  Defects Rate Impact:
    - Defects rate: ${params.defectsRate || 2}%
    - Quality loss: ${oeeResults.qualityLoss.toFixed(1)}%

OEE Formula: OEE = Availability × Performance × Quality
             ${oeeResults.availability.toFixed(1)}% × ${oeeResults.performance.toFixed(1)}% × ${oeeResults.quality.toFixed(1)}% = ${oeeResults.oee.toFixed(1)}%
`;

    if (toolComparisons.length > 0) {
        const sortedByCost = [...toolComparisons].sort((a, b) => a.totalCostPerPart - b.totalCostPerPart);
        const bestTool = sortedByCost[0];
        const worstTool = sortedByCost[sortedByCost.length - 1];
        const costDifference = worstTool.totalCostPerPart - bestTool.totalCostPerPart;
        const costSavingsPercent = ((costDifference / worstTool.totalCostPerPart) * 100).toFixed(1);
        const batchSize = params.batchSize || 1;
        const savingsPerBatch = costDifference * batchSize;
        const savingsPer100Parts = costDifference * 100;
        
        text += `
═══════════════════════════════════════════════════════════════
TOOL COMPARISON
═══════════════════════════════════════════════════════════════
`;
        toolComparisons.forEach((tool, index) => {
            text += `Tool ${index + 1}: ${tool.name}
  Brand: ${tool.toolBrand ? tool.toolBrand.charAt(0).toUpperCase() + tool.toolBrand.slice(1) : 'N/A'}
  Cost/Part: ${formatCurrency(tool.totalCostPerPart)}
  Tool Life: ${tool.toolLife} min
  MRR: ${formatNumber(tool.mrr, 'mm³/min')}
  Tool Cost: ${formatCurrency(tool.toolCost)}

`;
        });
        
        if (toolComparisons.length >= 2) {
            text += `═══════════════════════════════════════════════════════════════
POTENTIAL SAVINGS ANALYSIS
═══════════════════════════════════════════════════════════════
Best Tool (Lowest Cost): ${bestTool.name}
Best Tool Cost per Part: ${formatCurrency(bestTool.totalCostPerPart)}
Most Expensive Tool: ${worstTool.name}
Most Expensive Tool Cost per Part: ${formatCurrency(worstTool.totalCostPerPart)}

SAVINGS POTENTIAL:
Savings per Part: ${formatCurrency(costDifference)} (${costSavingsPercent}% reduction)
${batchSize > 1 ? `Savings per Batch (${batchSize} parts): ${formatCurrency(savingsPerBatch)}\n` : ''}Savings per 100 Parts: ${formatCurrency(savingsPer100Parts)}
`;
        }
    }
    
    text += `
═══════════════════════════════════════════════════════════════
ENGINEERING FORMULAS USED
═══════════════════════════════════════════════════════════════
Spindle Speed: n = (Vc × 1000) / (π × D)
Feed Rate: Vf = fz × Z × n
Material Removal Rate: Q = ae × ap × Vf
Cutting Force: Fc = kc × ap × ae × fz
Power Requirement: P = Fc × Vc / 60000
Torque: M = P × 9550 / n
Taylor's Tool Life: Vc × T^n = C

═══════════════════════════════════════════════════════════════════════════════
END OF REPORT
═══════════════════════════════════════════════════════════════════════════════

Report No: ${reportNumber}
Generated: ${reportDate.toLocaleString()}
Classification: CONFIDENTIAL

═══════════════════════════════════════════════════════════════════════════════
VENTEN OÜ
CNC Tool Selection & Analysis
ISO 8688-2:1989 Compliant

Contact: laurisoosaar@gmail.com
Website: https://www.venten.ee/

This document contains confidential and proprietary information.
Unauthorized disclosure, reproduction, or distribution is prohibited.
═══════════════════════════════════════════════════════════════════════════════
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
        // Load PDF libraries on demand
        if (typeof window.loadPDFLibraries === 'function') {
            await window.loadPDFLibraries();
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        const params = getInputValues();
        const toolLife = params.toolLife || calculateToolLife(params);
        const costResults = calculateCostPerPart({ ...params, toolLife });
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
        const oeeResults = calculateOEE(params, costResults, toolLife);
        
        const reportDate = new Date();
        const reportNumber = `RPT-${reportDate.getFullYear()}-${String(reportDate.getMonth() + 1).padStart(2, '0')}-${String(Date.now()).slice(-6)}`;
        
        let yPos = 20;
        const pageHeight = doc.internal.pageSize.height;
        const margin = 20;
        const lineHeight = 6;
        
        // Helper function to check if new page needed
        function checkNewPage(requiredSpace = 10) {
            if (yPos + requiredSpace > pageHeight - 15) {
                doc.addPage();
                yPos = 20;
                return true;
            }
            return false;
        }
        
        // Title
        doc.setFontSize(18);
        doc.setTextColor(37, 99, 235);
        // Professional Header
        doc.setFontSize(16);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');
        doc.text('VENTEN OÜ', margin, yPos);
        yPos += 8;
        
        doc.setFontSize(20);
        doc.setTextColor(44, 62, 80);
        doc.text('CNC TOOL SELECTION ANALYSIS REPORT', margin, yPos);
        yPos += 10;
        
        doc.setFontSize(10);
        doc.setTextColor(85, 85, 85);
        doc.setFont(undefined, 'italic');
        doc.text('Technical Evaluation Based on ISO 8688-2:1989 Standard', margin, yPos);
        yPos += 12;
        
        // Report metadata box
        doc.setDrawColor(189, 195, 199);
        doc.setLineWidth(0.5);
        doc.rect(margin, yPos, 170, 25);
        yPos += 7;
        
        doc.setFontSize(9);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'normal');
        doc.text(`Report No: ${reportNumber}`, margin + 3, yPos);
        yPos += 5;
        doc.text(`Date: ${reportDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, margin + 3, yPos);
        yPos += 5;
        doc.text(`Time: ${reportDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`, margin + 3, yPos);
        yPos += 5;
        doc.setFontSize(7);
        doc.setTextColor(192, 57, 43);
        doc.setFont(undefined, 'bold');
        doc.text('CLASSIFICATION: CONFIDENTIAL', margin + 3, yPos);
        yPos += 10;
        
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.setFont(undefined, 'normal');
        doc.text('ISO 8688-2:1989 - Tool life testing in milling Part 2: End milling', margin, yPos);
        yPos += 10;
        
        // Project Information
        checkNewPage(15);
        doc.setFontSize(14);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');
        doc.text('1. PROJECT INFORMATION', margin, yPos);
        doc.setDrawColor(189, 195, 199);
        doc.setLineWidth(0.5);
        doc.line(margin, yPos + 2, margin + 60, yPos + 2);
        yPos += 10;
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        if (params.clientName) { doc.text(`Client: ${params.clientName}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.projectName) { doc.text(`Project: ${params.projectName}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.partName) { doc.text(`Part: ${params.partName}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.machineName) { doc.text(`Machine: ${params.machineName}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.applicationType) { doc.text(`Application: ${params.applicationType}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.customerContact) { doc.text(`Contact: ${params.customerContact}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.expertName) { doc.text(`Our Expert: ${params.expertName}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.batchSize > 1) { doc.text(`Batch Size: ${params.batchSize} parts`, margin + 5, yPos); yPos += lineHeight; }
        if (params.theoreticalPartWorktime) { doc.text(`Theoretical Part Worktime: ${params.theoreticalPartWorktime} min`, margin + 5, yPos); yPos += lineHeight; }
        if (params.machineWorkhourCost) { doc.text(`Machine Workhour Cost: ${formatCurrency(params.machineWorkhourCost)}/hour`, margin + 5, yPos); yPos += lineHeight; }
        if (params.machineStopCost) { doc.text(`Machine Stop Cost: ${formatCurrency(params.machineStopCost)}/hour`, margin + 5, yPos); yPos += lineHeight; }
        yPos += 5;
        
        // Production & Cost Parameters
        if (params.partsPerBatch || params.partsPerYear || params.annualSolutions) {
            checkNewPage(15);
            doc.setFontSize(14);
            doc.setTextColor(44, 62, 80);
            doc.setFont(undefined, 'bold');
            doc.text('2. PRODUCTION & COST PARAMETERS', margin, yPos);
            doc.setDrawColor(189, 195, 199);
            doc.setLineWidth(0.5);
            doc.line(margin, yPos + 2, margin + 80, yPos + 2);
            yPos += 10;
            doc.setFontSize(10);
            if (params.partsPerBatch) { doc.text(`Parts per Batch: ${params.partsPerBatch}`, margin + 5, yPos); yPos += lineHeight; }
            if (params.partsPerYear) { doc.text(`Parts per Year: ${params.partsPerYear}`, margin + 5, yPos); yPos += lineHeight; }
            if (params.annualSolutions) { doc.text(`Annual Solutions: ${params.annualSolutions}`, margin + 5, yPos); yPos += lineHeight; }
            if (params.machineCostPerHour) { doc.text(`Machine Cost per Hour: ${formatCurrency(params.machineCostPerHour)}/hour`, margin + 5, yPos); yPos += lineHeight; }
            if (params.costOfToolChange) { doc.text(`Cost of Tool Change: ${formatCurrency(params.costOfToolChange)}`, margin + 5, yPos); yPos += lineHeight; }
            if (params.timeLossPerToolChange) { doc.text(`Time Loss per Tool Change: ${params.timeLossPerToolChange} min`, margin + 5, yPos); yPos += lineHeight; }
            if (params.machineStopDowntimeCost) { doc.text(`Machine Stop/Downtime Cost: ${formatCurrency(params.machineStopDowntimeCost)}/hour`, margin + 5, yPos); yPos += lineHeight; }
            yPos += 5;
        }
        
        // Tool Information
        checkNewPage(20);
        doc.setFontSize(14);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');
        doc.text('3. TOOL INFORMATION', margin, yPos);
        doc.setDrawColor(189, 195, 199);
        doc.setLineWidth(0.5);
        doc.line(margin, yPos + 2, margin + 50, yPos + 2);
        yPos += 10;
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        if (params.toolBrand) { doc.text(`Brand: ${params.toolBrand}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.toolType) { doc.text(`Type: ${params.toolType.replace(/([A-Z])/g, ' $1').trim()}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.toolNameModel) { doc.text(`Model: ${params.toolNameModel}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.toolProductCode) { doc.text(`Product Code: ${params.toolProductCode}`, margin + 5, yPos); yPos += lineHeight; }
        doc.text(`Diameter: ${params.toolDiameter} mm`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Number of Teeth: ${params.numberOfTeeth}`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Tool Material: ${params.toolMaterial}`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Coating: ${params.toolCoating}`, margin + 5, yPos); yPos += lineHeight;
        if (params.cuttingFluid && params.cuttingFluid !== 'none') { doc.text(`Cutting Fluid: ${formatCuttingFluid(params.cuttingFluid)}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.helixAngle) { doc.text(`Helix Angle: ${params.helixAngle}°`, margin + 5, yPos); yPos += lineHeight; }
        if (params.rakeAngle) { doc.text(`Rake Angle: ${params.rakeAngle}°`, margin + 5, yPos); yPos += lineHeight; }
        doc.text(`Tool Cost: ${formatCurrency(params.toolCost)}`, margin + 5, yPos); yPos += lineHeight;
        if (params.toolRemainingCost > 0) { doc.text(`Residual Value: ${formatCurrency(params.toolRemainingCost)}`, margin + 5, yPos); yPos += lineHeight; }
        yPos += 5;
        
        // Workpiece Material
        checkNewPage(10);
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('Workpiece Material', margin, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.text(`Material: ${params.workpieceMaterial}`, margin + 5, yPos); yPos += lineHeight;
        if (params.materialHardness) { doc.text(`Hardness (HRC): ${params.materialHardness}`, margin + 5, yPos); yPos += lineHeight; }
        yPos += 5;
        
        // Cutting Parameters
        checkNewPage(15);
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('Cutting Parameters', margin, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.text(`Cutting Speed (Vc): ${params.cuttingSpeed} m/min`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Feed per Tooth (fz): ${params.feedRate} mm/tooth`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Axial Depth (ap): ${params.depthOfCut} mm`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Radial Width (ae): ${params.widthOfCut} mm`, margin + 5, yPos); yPos += lineHeight;
        if (params.cuttingFluid && params.cuttingFluid !== 'none') { doc.text(`Cutting Fluid: ${formatCuttingFluid(params.cuttingFluid)}`, margin + 5, yPos); yPos += lineHeight; }
        yPos += 5;
        
        // Calculated Parameters
        checkNewPage(20);
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('Calculated Machining Parameters', margin, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.text(`Spindle Speed (n): ${formatNumber(spindleSpeed, 'RPM')}`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Feed Rate (Vf): ${formatNumber(feedRateMM, 'mm/min')}`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Feed per Rev (f): ${formatNumber(feedPerRev, 'mm/rev')}`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`MRR (Q): ${formatNumber(mrr, 'mm³/min')}`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Chip Thickness (h): ${formatNumber(chipThickness, 'mm')}`, margin + 5, yPos); yPos += 5;
        
        // Forces & Power
        checkNewPage(20);
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('Cutting Forces & Power', margin, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.text(`Specific Cutting Force (kc): ${formatNumber(specificCuttingForce, 'N/mm²')}`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Cutting Force (Fc): ${formatNumber(cuttingForce, 'N')}`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Power (P): ${formatNumber(powerRequired, 'kW')}`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Torque (M): ${formatNumber(torque, 'Nm')}`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`MRR per Power: ${formatNumber(mrrPerPower, 'cm³/min/kW')}`, margin + 5, yPos); yPos += 5;
        
        // Surface Quality
        checkNewPage(10);
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('Surface Quality', margin, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.text(`Surface Roughness (Ra): ${formatNumber(surfaceFinish, 'μm')}`, margin + 5, yPos); yPos += 5;
        
        // Time Parameters
        checkNewPage(15);
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('Time Parameters', margin, yPos);
        yPos += 8;
        doc.setFontSize(10);
        if (params.processingTime) { doc.text(`Processing Time: ${params.processingTime} min`, margin + 5, yPos); yPos += lineHeight; }
        if (params.toolChangeTime) { doc.text(`Tool Change Time: ${params.toolChangeTime} min`, margin + 5, yPos); yPos += lineHeight; }
        const machiningTime = params.machiningTime !== null && params.machiningTime !== undefined 
            ? params.machiningTime 
            : (params.processingTime + (params.toolChangeTime || 0));
        doc.text(`Total Machining Time: ${machiningTime} min`, margin + 5, yPos); yPos += lineHeight;
        if (params.machineHourlyRate) { doc.text(`Machine Rate: ${formatCurrency(params.machineHourlyRate)}/hour`, margin + 5, yPos); yPos += lineHeight; }
        if (params.toolChangeCost > 0) { doc.text(`Tool Change Cost: ${formatCurrency(params.toolChangeCost)}`, margin + 5, yPos); yPos += lineHeight; }
        yPos += 5;
        
        // Cost Analysis
        checkNewPage(20);
        doc.setFontSize(14);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');
        doc.text('COST ANALYSIS', margin, yPos);
        doc.setDrawColor(189, 195, 199);
        doc.setLineWidth(0.5);
        doc.line(margin, yPos + 2, margin + 45, yPos + 2);
        yPos += 10;
        doc.setFontSize(12);
        doc.setTextColor(37, 99, 235);
        doc.text(`Total Cost per Part: ${formatCurrency(costResults.totalCostPerPart)}`, margin + 5, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text(`Tool Cost per Part: ${formatCurrency(costResults.toolCostPerPart)}`, margin + 5, yPos); yPos += lineHeight;
        if (costResults.processingCostPerPart) { doc.text(`Processing Cost: ${formatCurrency(costResults.processingCostPerPart)}`, margin + 5, yPos); yPos += lineHeight; }
        doc.text(`Machining Cost per Part: ${formatCurrency(costResults.machiningCostPerPart)}`, margin + 5, yPos); yPos += lineHeight;
        if (costResults.toolChangeCostPerPart > 0) { doc.text(`Tool Change Cost: ${formatCurrency(costResults.toolChangeCostPerPart)}`, margin + 5, yPos); yPos += lineHeight; }
        if (params.batchSize > 1) {
            yPos += 3;
            doc.setFontSize(11);
            doc.setTextColor(30, 41, 59);
            doc.text(`Batch Cost (${params.batchSize} parts): ${formatCurrency(costResults.totalBatchCost)}`, margin + 5, yPos);
            yPos += lineHeight;
            doc.setFontSize(10);
            doc.text(`Tool Cost for Batch: ${formatCurrency(costResults.totalToolCostForBatch)}`, margin + 5, yPos); yPos += lineHeight;
            doc.text(`Machining Cost for Batch: ${formatCurrency(costResults.totalMachiningCostForBatch)}`, margin + 5, yPos); yPos += lineHeight;
        }
        yPos += 5;
        
        // Tool Life
        checkNewPage(15);
        doc.setFontSize(14);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');
        doc.text('TOOL LIFE & PERFORMANCE', margin, yPos);
        doc.setDrawColor(189, 195, 199);
        doc.setLineWidth(0.5);
        doc.line(margin, yPos + 2, margin + 70, yPos + 2);
        yPos += 10;
        doc.setFontSize(10);
        doc.text(`Estimated Tool Life (T): ${toolLife} minutes`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Parts per Tool Life: ${costResults.partsPerToolLife} parts`, margin + 5, yPos); yPos += lineHeight;
        if (costResults.toolChangesPerToolLife > 0) { doc.text(`Tool Changes: ${costResults.toolChangesPerToolLife}`, margin + 5, yPos); yPos += lineHeight; }
        doc.text(`Taylor's Constant (C): ${formatNumber(taylorConstant, '')}`, margin + 5, yPos); yPos += lineHeight;
        doc.text(`Taylor Exponent (n): 0.2`, margin + 5, yPos); yPos += 5;
        
        // OEE Analysis
        checkNewPage(30);
        doc.setFontSize(14);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');
        doc.text('OEE ANALYSIS (OVERALL EQUIPMENT EFFECTIVENESS)', margin, yPos);
        doc.setDrawColor(189, 195, 199);
        doc.setLineWidth(0.5);
        doc.line(margin, yPos + 2, margin + 90, yPos + 2);
        yPos += 10;
        doc.setFontSize(12);
        doc.setTextColor(37, 99, 235);
        doc.text(`Overall OEE: ${oeeResults.oee.toFixed(1)}%`, margin + 5, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text('OEE Components:', margin + 5, yPos); yPos += lineHeight;
        doc.text(`  Availability: ${oeeResults.availability.toFixed(1)}% (Loss: ${oeeResults.availabilityLoss.toFixed(1)}%)`, margin + 10, yPos); yPos += lineHeight;
        doc.text(`  Performance: ${oeeResults.performance.toFixed(1)}% (Loss: ${oeeResults.performanceLoss.toFixed(1)}%)`, margin + 10, yPos); yPos += lineHeight;
        doc.text(`  Quality: ${oeeResults.quality.toFixed(1)}% (Defects: ${params.defectsRate || 2}%)`, margin + 10, yPos); yPos += lineHeight + 3;
        doc.text('OEE Impact Factors:', margin + 5, yPos); yPos += lineHeight;
        doc.text(`  Tool Change: ${(oeeResults.toolChangeImpact.downtime * 60).toFixed(2)} min/part, ${formatCurrency(oeeResults.toolChangeImpact.cost)}/part`, margin + 10, yPos); yPos += lineHeight;
        doc.text(`  Speed: ${params.cuttingSpeed} m/min${oeeResults.speedImpact.toolLifeReduction > 0 ? ` (Tool life reduction: ${(oeeResults.speedImpact.toolLifeReduction * 100).toFixed(1)}%)` : ''}`, margin + 10, yPos); yPos += lineHeight;
        doc.text(`  Tool Life: ${toolLife} min, ${oeeResults.partsPerToolLife} parts/tool life`, margin + 10, yPos); yPos += lineHeight;
        doc.text(`  Downtime: ${oeeResults.downtimePerPart.toFixed(2)} min/part`, margin + 10, yPos); yPos += lineHeight;
        doc.text(`  Defects Rate: ${params.defectsRate || 2}%`, margin + 10, yPos); yPos += 5;
        
        // Add charts to PDF if available
        const includeCharts = document.getElementById('includeCharts')?.checked;
        if (includeCharts) {
            // Tool Life Chart
            if (toolLifeChartInstance) {
                try {
                    const chartImage = getChartImage(toolLifeChartInstance);
                    if (chartImage) {
                        checkNewPage(60);
                        doc.setFontSize(12);
                        doc.setTextColor(30, 41, 59);
                        doc.text('Tool Life Chart', margin, yPos);
                        yPos += 8;
                        doc.addImage(chartImage, 'PNG', margin, yPos, 170, 80);
                        yPos += 85;
                    }
                } catch (error) {
                    console.error('Error adding tool life chart to PDF:', error);
                }
            }
            
            // Cost Savings Chart
            if (costSavingsChartInstance) {
                try {
                    const chartImage = getChartImage(costSavingsChartInstance);
                    if (chartImage) {
                        checkNewPage(60);
                        doc.setFontSize(12);
                        doc.setTextColor(30, 41, 59);
                        doc.text('Cost Breakdown Chart', margin, yPos);
                        yPos += 8;
                        doc.addImage(chartImage, 'PNG', margin, yPos, 170, 80);
                        yPos += 85;
                    }
                } catch (error) {
                    console.error('Error adding cost chart to PDF:', error);
                }
            }
        }
        
        // Tool Comparison
        if (toolComparisons.length > 0) {
            checkNewPage(25);
            doc.setFontSize(14);
            doc.setTextColor(30, 41, 59);
            doc.text('Tool Comparison', margin, yPos);
            yPos += 8;
            doc.setFontSize(9);
            
            toolComparisons.forEach((tool, index) => {
                checkNewPage(15);
                doc.text(`Tool ${index + 1}: ${tool.name}`, margin + 5, yPos); yPos += lineHeight;
                doc.text(`  Cost/Part: ${formatCurrency(tool.totalCostPerPart)} | Life: ${tool.toolLife} min | MRR: ${formatNumber(tool.mrr, 'mm³/min')}`, margin + 5, yPos); yPos += lineHeight + 2;
            });
            
            if (toolComparisons.length >= 2) {
                const sortedByCost = [...toolComparisons].sort((a, b) => a.totalCostPerPart - b.totalCostPerPart);
                const bestTool = sortedByCost[0];
                const worstTool = sortedByCost[sortedByCost.length - 1];
                const costDifference = worstTool.totalCostPerPart - bestTool.totalCostPerPart;
                const costSavingsPercent = ((costDifference / worstTool.totalCostPerPart) * 100).toFixed(1);
                const batchSize = params.batchSize || 1;
                const savingsPerBatch = costDifference * batchSize;
                
                checkNewPage(20);
                doc.setFontSize(14);
                doc.setTextColor(30, 41, 59);
                doc.text('Potential Savings', margin, yPos);
                yPos += 8;
                doc.setFontSize(10);
                doc.text(`Best Tool: ${bestTool.name} (${formatCurrency(bestTool.totalCostPerPart)}/part)`, margin + 5, yPos); yPos += lineHeight;
                doc.text(`Savings per Part: ${formatCurrency(costDifference)} (${costSavingsPercent}%)`, margin + 5, yPos); yPos += lineHeight;
                if (batchSize > 1) { doc.text(`Savings per Batch: ${formatCurrency(savingsPerBatch)}`, margin + 5, yPos); yPos += lineHeight; }
                
                // Add comparison charts to PDF
                const includeCharts = document.getElementById('includeCharts')?.checked;
                if (includeCharts) {
                    // Tool Life Comparison Chart
                    if (comparisonToolLifeChartInstance) {
                        try {
                            const chartImage = getChartImage(comparisonToolLifeChartInstance);
                            if (chartImage) {
                                checkNewPage(60);
                                doc.setFontSize(12);
                                doc.setTextColor(30, 41, 59);
                                doc.text('Tool Life Comparison', margin, yPos);
                                yPos += 8;
                                doc.addImage(chartImage, 'PNG', margin, yPos, 170, 80);
                                yPos += 85;
                            }
                        } catch (error) {
                            console.error('Error adding comparison tool life chart to PDF:', error);
                        }
                    }
                    
                    // Cost Comparison Chart
                    if (comparisonCostChartInstance) {
                        try {
                            const chartImage = getChartImage(comparisonCostChartInstance);
                            if (chartImage) {
                                checkNewPage(60);
                                doc.setFontSize(12);
                                doc.setTextColor(30, 41, 59);
                                doc.text('Cost Comparison', margin, yPos);
                                yPos += 8;
                                doc.addImage(chartImage, 'PNG', margin, yPos, 170, 80);
                                yPos += 85;
                            }
                        } catch (error) {
                            console.error('Error adding cost comparison chart to PDF:', error);
                        }
                    }
                    
                    // Efficiency Chart
                    if (comparisonEfficiencyChartInstance) {
                        try {
                            const chartImage = getChartImage(comparisonEfficiencyChartInstance);
                            if (chartImage) {
                                checkNewPage(60);
                                doc.setFontSize(12);
                                doc.setTextColor(30, 41, 59);
                                doc.text('Efficiency Metrics', margin, yPos);
                                yPos += 8;
                                doc.addImage(chartImage, 'PNG', margin, yPos, 170, 80);
                                yPos += 85;
                            }
                        } catch (error) {
                            console.error('Error adding efficiency chart to PDF:', error);
                        }
                    }
                }
            }
        }
        
        // Professional Footer
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            
            // Footer line
            doc.setDrawColor(189, 195, 199);
            doc.setLineWidth(0.5);
            doc.line(margin, pageHeight - 20, 190, pageHeight - 20);
            
            // Footer text
            doc.text('VENTEN OÜ - CNC Tool Selection & Analysis', margin, pageHeight - 15);
            doc.text(`Report No: ${reportNumber} | Page ${i} of ${totalPages}`, margin, pageHeight - 10);
            doc.setFontSize(7);
            doc.setTextColor(150, 150, 150);
            doc.text('ISO 8688-2:1989 Compliant | https://www.venten.ee/', margin, pageHeight - 5);
        }
        
        // Save PDF with report number
        doc.save(`CNC_Tool_Report_${reportNumber}.pdf`);
        
        statusDiv.innerHTML = '<p style="color: var(--secondary-color);">✓ PDF report downloaded successfully!</p>';
        
    } catch (error) {
        statusDiv.innerHTML = `<p style="color: var(--danger-color);">Error generating PDF: ${error.message}</p>`;
    }
}

// Load Venten logo from their website
function loadVentenLogo() {
    const logoImg = document.getElementById('ventenLogo');
    const logoText = document.getElementById('ventenLogoText');
    
    if (!logoImg) return;
    
    // Common logo paths to try (Magento and WordPress common locations)
    const logoPaths = [
        'https://www.venten.ee/media/logo/default/logo.png',
        'https://www.venten.ee/media/wysiwyg/logo.png',
        'https://www.venten.ee/media/logo/logo.png',
        'https://www.venten.ee/media/wysiwyg/venten_ainultlogo.png',
        'https://www.venten.ee/skin/frontend/default/default/images/logo.png',
        'https://www.venten.ee/wp-content/themes/venten/images/logo.png'
    ];
    
    let currentIndex = 0;
    
    function tryNextLogo() {
        if (currentIndex >= logoPaths.length) {
            // All paths failed, show text fallback
            logoImg.style.display = 'none';
            logoText.style.display = 'inline-block';
            return;
        }
        
        logoImg.src = logoPaths[currentIndex];
        logoImg.onload = function() {
            logoImg.style.display = 'inline-block';
            logoText.style.display = 'none';
        };
        logoImg.onerror = function() {
            currentIndex++;
            tryNextLogo();
        };
    }
    
    tryNextLogo();
}

// Show toast notification
function showToast(message, type = 'info', duration = 3000) {
    // Remove existing toast if any
    const existingToast = document.getElementById('toastNotification');
    if (existingToast) {
        existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.id = 'toastNotification';
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Validate input parameters
function validateInputs(params) {
    const errors = [];
    
    if (!params.toolDiameter || params.toolDiameter <= 0) {
        errors.push('Tool diameter must be greater than 0');
    }
    if (!params.cuttingSpeed || params.cuttingSpeed <= 0) {
        errors.push('Cutting speed must be greater than 0');
    }
    if (!params.feedRate || params.feedRate <= 0) {
        errors.push('Feed per tooth must be greater than 0');
    }
    if (!params.depthOfCut || params.depthOfCut <= 0) {
        errors.push('Depth of cut must be greater than 0');
    }
    if (!params.widthOfCut || params.widthOfCut <= 0) {
        errors.push('Width of cut must be greater than 0');
    }
    if (!params.numberOfTeeth || params.numberOfTeeth <= 0) {
        errors.push('Number of teeth must be greater than 0');
    }
    if (!params.toolCost || params.toolCost <= 0) {
        errors.push('Tool cost must be greater than 0');
    }
    if (!params.machineHourlyRate || params.machineHourlyRate <= 0) {
        errors.push('Machine hourly rate must be greater than 0');
    }
    
    return errors;
}

// Set button loading state
function setButtonLoading(buttonId, isLoading, originalText = null) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    
    if (isLoading) {
        button.dataset.originalText = button.textContent;
        button.disabled = true;
        button.classList.add('loading');
        button.innerHTML = '<span class="spinner"></span> Processing...';
    } else {
        button.disabled = false;
        button.classList.remove('loading');
        button.textContent = originalText || button.dataset.originalText || button.textContent;
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Load Venten logo
    loadVentenLogo();
    
    // Initialize photo upload (async, but don't block)
    setTimeout(async function() {
        try {
            await initializePhotoUpload();
        } catch (error) {
            console.error('Error initializing photo upload:', error);
        }
    }, 100);
    
    // Initialize machine label upload with OCR
    setTimeout(function() {
        initializeMachineLabelUpload();
    }, 150);
    
    // Initialize catalogue import (async, but don't block)
    setTimeout(async function() {
        try {
            await initializeCatalogueImport();
        } catch (error) {
            console.error('Error initializing catalogue import:', error);
        }
    }, 150);
    
    // Initialize report generation
    initializeReportGeneration();
    
    // Calculate button with enhanced feedback
    const calculateBtn = document.getElementById('calculateBtn');
    if (!calculateBtn) {
        console.error('Calculate button not found');
        return;
    }
    calculateBtn.addEventListener('click', function() {
        const button = this;
        const originalText = button.textContent;
        
        try {
            // Set loading state
            setButtonLoading('calculateBtn', true, originalText);
            
            // Get and validate inputs
            const params = getInputValues();
            const validationErrors = validateInputs(params);
            
            if (validationErrors.length > 0) {
                setButtonLoading('calculateBtn', false, originalText);
                showToast(`⚠️ Please fix errors: ${validationErrors[0]}`, 'error', 5000);
                
                // Highlight problematic fields
                validationErrors.forEach(error => {
                    if (error.includes('diameter')) {
                        document.getElementById('toolDiameter')?.classList.add('error-field');
                    } else if (error.includes('cutting speed')) {
                        document.getElementById('cuttingSpeed')?.classList.add('error-field');
                    } else if (error.includes('feed')) {
                        document.getElementById('feedRate')?.classList.add('error-field');
                    } else if (error.includes('depth')) {
                        document.getElementById('depthOfCut')?.classList.add('error-field');
                    } else if (error.includes('width')) {
                        document.getElementById('widthOfCut')?.classList.add('error-field');
                    } else if (error.includes('teeth')) {
                        document.getElementById('numberOfTeeth')?.classList.add('error-field');
                    } else if (error.includes('Tool cost')) {
                        document.getElementById('toolCost')?.classList.add('error-field');
                    } else if (error.includes('Machine')) {
                        document.getElementById('machineHourlyRate')?.classList.add('error-field');
                    }
                });
                
                return;
            }
            
            // Remove error highlights
            document.querySelectorAll('.error-field').forEach(el => el.classList.remove('error-field'));
            
            // Simulate processing delay for better UX
            setTimeout(() => {
                try {
                    const toolLife = params.toolLife || calculateToolLife(params);
                    const costResults = calculateCostPerPart({ ...params, toolLife });
                    
                    // Scroll to results
                    document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
                    
                    // Display results
                    displayResults(params, costResults).catch(error => {
                        console.error('Error displaying results:', error);
                        setButtonLoading('calculateBtn', false, originalText);
                        showToast(`❌ Error displaying results: ${error.message}`, 'error', 5000);
                    });
                    
                    // Show success message
                    setButtonLoading('calculateBtn', false, originalText);
                    showToast('✅ Calculation completed successfully!', 'success', 3000);
                    
                    // Add success animation to results container
                    const resultsContainer = document.getElementById('results');
                    resultsContainer.classList.add('results-animate');
                    setTimeout(() => resultsContainer.classList.remove('results-animate'), 1000);
                    
                } catch (error) {
                    setButtonLoading('calculateBtn', false, originalText);
                    showToast(`❌ Calculation error: ${error.message}`, 'error', 5000);
                    console.error('Calculation error:', error);
                }
            }, 300);
            
        } catch (error) {
            setButtonLoading('calculateBtn', false, originalText);
            showToast(`❌ Error: ${error.message}`, 'error', 5000);
            console.error('Error:', error);
        }
    });
    
    // Compare Tools button with enhanced feedback
    const compareBtn = document.getElementById('compareBtn');
    if (compareBtn) {
        compareBtn.addEventListener('click', function() {
            const button = this;
        const originalText = button.textContent;
        
        try {
            // Set loading state
            setButtonLoading('compareBtn', true, originalText);
            
            // Get and validate inputs
            const params = getInputValues();
            const validationErrors = validateInputs(params);
            
            if (validationErrors.length > 0) {
                setButtonLoading('compareBtn', false, originalText);
                showToast(`⚠️ Please fix errors before comparing: ${validationErrors[0]}`, 'error', 5000);
                return;
            }
            
            // Simulate processing delay
            setTimeout(() => {
                try {
                    const toolLife = params.toolLife || calculateToolLife(params);
                    const costResults = calculateCostPerPart({ ...params, toolLife });
                    
                    // Create tool name for comparison
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
                    }
                    
                    // Add to comparison
                    addToComparison();
                    
                    // Scroll to comparison section
                    const comparisonSection = document.getElementById('comparisonSection');
                    if (comparisonSection && comparisonSection.style.display !== 'none') {
                        comparisonSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        // Highlight comparison section
                        comparisonSection.classList.add('highlight-section');
                        setTimeout(() => comparisonSection.classList.remove('highlight-section'), 2000);
                    }
                    
                    // Show success message
                    setButtonLoading('compareBtn', false, originalText);
                    showToast(`✅ "${toolName}" added to comparison (${toolComparisons.length} tool${toolComparisons.length > 1 ? 's' : ''})`, 'success', 3000);
                    
                } catch (error) {
                    setButtonLoading('compareBtn', false, originalText);
                    showToast(`❌ Error adding tool: ${error.message}`, 'error', 5000);
                    console.error('Comparison error:', error);
                }
            }, 300);
            
        } catch (error) {
            setButtonLoading('compareBtn', false, originalText);
            showToast(`❌ Error: ${error.message}`, 'error', 5000);
            console.error('Error:', error);
        }
        });
    }
    
    // Clear comparison button
    const clearComparisonBtn = document.getElementById('clearComparisonBtn');
    if (clearComparisonBtn) {
        clearComparisonBtn.addEventListener('click', function() {
            if (toolComparisons.length === 0) {
                showToast('ℹ️ No tools to clear', 'info', 2000);
                return;
            }
            
            const count = toolComparisons.length;
            clearComparison();
            showToast(`✅ Cleared ${count} tool${count > 1 ? 's' : ''} from comparison`, 'success', 3000);
        });
    }
    
    // Add another tool button (also handles update when editing)
    const addToolBtn = document.getElementById('addToolBtn');
    if (addToolBtn) {
        addToolBtn.addEventListener('click', function() {
        const button = this;
        const originalText = button.textContent;
        
        // Check if we're in edit mode
        if (window.editingToolId) {
            const toolId = window.editingToolId;
            try {
                setButtonLoading('addToolBtn', true, originalText);
                
                const params = getInputValues();
                const validationErrors = validateInputs(params);
                
                if (validationErrors.length > 0) {
                    setButtonLoading('addToolBtn', false, originalText);
                    showToast(`⚠️ Please fix errors before updating: ${validationErrors[0]}`, 'error', 5000);
                    return;
                }
                
                setTimeout(() => {
                    try {
                        updateToolInComparison(toolId);
                        setButtonLoading('addToolBtn', false, 'Add Another Tool');
                        showToast(`✅ Tool updated successfully`, 'success', 3000);
                    } catch (error) {
                        setButtonLoading('addToolBtn', false, originalText);
                        showToast(`❌ Error: ${error.message}`, 'error', 5000);
                    }
                }, 300);
            } catch (error) {
                setButtonLoading('addToolBtn', false, originalText);
                showToast(`❌ Error: ${error.message}`, 'error', 5000);
            }
            return;
        }
        
        // Normal add mode
        try {
            setButtonLoading('addToolBtn', true, originalText);
            
            const params = getInputValues();
            const validationErrors = validateInputs(params);
            
            if (validationErrors.length > 0) {
                setButtonLoading('addToolBtn', false, originalText);
                showToast(`⚠️ Please fix errors before adding: ${validationErrors[0]}`, 'error', 5000);
                return;
            }
            
            setTimeout(() => {
                try {
                    addToComparison();
                    
                    let toolName = `Tool ${toolComparisons.length}`;
                    if (params.toolNameModel) {
                        toolName = params.toolNameModel;
                    }
                    
                    setButtonLoading('addToolBtn', false, originalText);
                    showToast(`✅ "${toolName}" added (${toolComparisons.length} tool${toolComparisons.length > 1 ? 's' : ''} total)`, 'success', 3000);
                    
                    const comparisonSection = document.getElementById('comparisonSection');
                    if (comparisonSection) {
                        comparisonSection.classList.add('highlight-section');
                        setTimeout(() => comparisonSection.classList.remove('highlight-section'), 2000);
                    }
                    
                } catch (error) {
                    setButtonLoading('addToolBtn', false, originalText);
                    showToast(`❌ Error: ${error.message}`, 'error', 5000);
                }
            }, 300);
            
        } catch (error) {
            setButtonLoading('addToolBtn', false, originalText);
            showToast(`❌ Error: ${error.message}`, 'error', 5000);
        }
        });
    }
    
    // Save & Clear Form button
    const saveAndClearBtn = document.getElementById('saveAndClearBtn');
    if (saveAndClearBtn) {
        saveAndClearBtn.addEventListener('click', function() {
            const button = this;
            const originalText = button.textContent;
            
            try {
                setButtonLoading('saveAndClearBtn', true, originalText);
                
                setTimeout(() => {
                    try {
                        if (typeof saveAndClearForm === 'function') {
                            saveAndClearForm();
                        } else {
                            console.error('saveAndClearForm function not found');
                        }
                        setButtonLoading('saveAndClearBtn', false, originalText);
                    } catch (error) {
                        setButtonLoading('saveAndClearBtn', false, originalText);
                        showToast(`❌ Error: ${error.message}`, 'error', 5000);
                        console.error('Save & Clear error:', error);
                    }
                }, 300);
                
            } catch (error) {
                setButtonLoading('saveAndClearBtn', false, originalText);
                showToast(`❌ Error: ${error.message}`, 'error', 5000);
                console.error('Error:', error);
            }
        });
    }
    
    // Remove error highlights on input
    const inputs = document.querySelectorAll('input, select');
    inputs.forEach(input => {
        input.addEventListener('input', function() {
            this.classList.remove('error-field');
        });
        input.addEventListener('change', function() {
            this.classList.remove('error-field');
        });
    });
});
