# CNC Tool Selection Calculator

A comprehensive web-based calculator to help you choose the right and most cost-effective tool for your CNC machine, based on ISO 8688-2:1989 principles.

## Features

- **Cost-Effectiveness Analysis**: Calculate total cost per part including tool and machining costs
- **Tool Life Estimation**: Estimate tool life based on ISO 8688-2 principles using material, tool, and cutting parameters
- **Material Removal Rate (MRR)**: Calculate material removal rate for productivity assessment
- **Tool Comparison**: Compare multiple tools side-by-side to find the most cost-effective option
- **Smart Recommendations**: Get AI-powered recommendations for optimizing tool selection and cutting parameters

## How to Use

1. **Open the Calculator**: Simply open `index.html` in your web browser
2. **Enter Parameters**:
   - Select workpiece material (Steel, Cast Iron, Aluminum, etc.)
   - Enter tool specifications (diameter, material, coating)
   - Set cutting parameters (speed, feed rate, depth/width of cut)
   - Enter cost information (tool cost, machine hourly rate)
3. **Calculate**: Click "Calculate Cost-Effectiveness" to see results
4. **Compare Tools**: Use "Compare Tools" to add current tool to comparison table
5. **Review Recommendations**: Check the recommendations section for optimization tips

## Key Calculations

### Tool Life (ISO 8688-2 Based)
The calculator uses Taylor's tool life equation principles, adjusted for:
- Workpiece material properties
- Tool material (HSS, Carbide, Coated Carbide, etc.)
- Tool coatings (TiN, TiCN, AlCrN, Diamond)
- Cutting speed, feed rate, and depth of cut

### Cost per Part
- **Tool Cost per Part** = Tool Cost / Tool Life
- **Machining Cost per Part** = (Machining Time / 60) × Machine Hourly Rate
- **Total Cost per Part** = Tool Cost per Part + Machining Cost per Part

### Material Removal Rate (MRR)
MRR = Width × Depth × Feed Rate × Number of Teeth × RPM

## Supported Materials

- Steel
- Cast Iron
- Aluminum
- Stainless Steel
- Titanium
- Brass

## Tool Materials

- High-Speed Steel (HSS)
- Cemented Carbide
- Coated Carbide
- Ceramic
- Diamond

## Tool Coatings

- None
- TiN (Titanium Nitride)
- TiCN (Titanium Carbonitride)
- AlCrN (Aluminum Chromium Nitride)
- Diamond Coating

## Browser Compatibility

Works on all modern browsers:
- Chrome/Edge (recommended)
- Firefox
- Safari
- Opera

## Technical Details

Based on ISO 8688-2:1989 - Tool life testing in milling Part 2: End milling

The calculator implements:
- Material-specific cutting speed multipliers
- Tool material performance factors
- Coating enhancement factors
- Taylor's tool life equation principles
- Cost-effectiveness optimization algorithms

## License

Free to use for CNC machining operations and tool selection optimization.
