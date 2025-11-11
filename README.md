# Stagify Project Imagination

A Node.js pipeline that converts CAD floorplan PDFs into photorealistic 3D interior visualizations using AI. The system processes PDF pages, identifies room names via OCR, generates detailed descriptions using GPT, and creates stunning 3D room renders using Google Gemini's image generation capabilities.

## Features

- **PDF to PNG Conversion**: Converts PDF pages to high-resolution PNG images
- **Automatic Room Identification**: Uses OCR (Tesseract.js) to extract room names from page headings
- **Smart Page Grouping**: Automatically groups consecutive pages belonging to the same room
- **AI-Powered Description**: Uses OpenAI GPT to generate detailed, quantitative descriptions of floorplans
- **3D Image Generation**: Uses Google Gemini to generate photorealistic 3D interior visualizations
- **Parallel Processing**: Process multiple rooms concurrently for faster results
- **Title Overlay**: Automatically adds room names to generated images

## Prerequisites

- Node.js (v14 or higher)
- OpenAI API key (for GPT descriptions)
- Google Gemini API key (for image generation)
- PDF files containing floorplan pages

## Installation

1. Clone the repository:
```bash
git clone https://github.com/MaximilianIsing/Stagify-Project-Imagination.git
cd Stagify-Project-Imagination
```

2. Install dependencies:
```bash
npm install
```

3. Set up API keys:
   - Create a file named `gpt-key.txt` in the project root and add your OpenAI API key
   - Create a file named `key.txt` in the project root and add your Google Gemini API key
   - Alternatively, set environment variables:
     - `OPENAI_API_KEY` for OpenAI
     - `GEMINI_API_KEY` for Google Gemini

## Usage

### Command Line

The simplest way to process a PDF:

```bash
node PDFGenerate.js path/to/your/floorplan.pdf
```

**Options:**

- `--pagesDir=<dir>`: Directory to save PDF page images (default: `pdf-pages`)
- `--outputDir=<dir>`: Directory to save generated renders (default: `generated`)
- `--skip=<n>`: Number of pages to skip from the beginning (default: `5`)
- `--concurrency=<n>`: Number of rooms to process in parallel (default: `2`)
- `--dpi=<n>`: DPI for PDF to PNG conversion (default: `110`)
- `--gemini-key=<path>`: Path to Gemini API key file (default: `key.txt`)
- `--continue`: Continue processing even if individual pages fail
- `--prefix=<string>`: File prefix for page images (default: `page`)
- `--no-pad`: Disable page padding

**Example:**

```bash
node PDFGenerate.js sample.pdf --skip=5 --concurrency=4 --outputDir=output --dpi=144
```

### Programmatic Usage

```javascript
const { pdfGenerate } = require('./PDFGenerate');

async function processPDF() {
  const result = await pdfGenerate('path/to/floorplan.pdf', {
    skipPages: 5,
    concurrency: 2,
    outputDir: 'generated',
    pagesDir: 'pdf-pages',
    continueOnError: true,
    pdfOptions: {
      dpi: 110,
      filePrefix: 'page',
      padPages: true
    },
    identifyRoomOptions: {
      topCropRatio: 0.1,
      innerBandRatio: 0.2,
      innerWidthRatio: 0.25,
      minConfidence: 45
    }
  });

  console.log(`Processed ${result.processedPages.length} pages`);
  console.log(`Generated ${result.processedPages.filter(p => p.renderPath).length} renders`);
}
```

## How It Works

1. **PDF Rendering**: Converts each PDF page to a PNG image using `pdfjs-dist`
2. **Room Identification**: Uses OCR to extract room names from the top section of each page
3. **Page Grouping**: Groups consecutive pages with the same room name
4. **Description Generation**: Sends floorplan images to GPT to generate detailed descriptions with:
   - Room dimensions and layout
   - Furniture positions and quantities
   - Window and door locations
   - Material and color specifications
   - Structured JSON geometry data
5. **Image Generation**: Sends descriptions and reference images to Gemini to generate 3D renders
6. **Title Overlay**: Adds the room name as a title on the generated image

## Project Structure

```
.
├── PDFGenerate.js          # Main orchestration script
├── pdfToPng.js             # PDF to PNG conversion
├── identify-room.js        # OCR-based room name extraction
├── describe.js             # GPT-powered floorplan description
├── generate-room.js        # Gemini-powered 3D image generation
├── page-processing.js      # Single page/group processing
├── text-adder.js           # Title overlay utility
├── package.json            # Dependencies
├── README.md               # This file
├── .gitignore              # Git ignore rules
├── gpt-key.txt             # OpenAI API key (not committed)
├── key.txt                 # Gemini API key (not committed)
├── pdf-pages/              # Generated page images
└── generated/              # Generated 3D renders
```

## API Keys

The system looks for API keys in the following order:

**OpenAI (GPT):**
1. `options.apiKey` (programmatic)
2. `gpt-key.txt` file
3. `key.txt` file
4. `OPENAI_API_KEY` environment variable

**Google Gemini:**
1. `options.apiKey` (programmatic)
2. `key.txt` file
3. `gemini-key.txt` file
4. `GEMINI_API_KEY` environment variable

## Output

The pipeline generates:

- **Page Images**: PNG files in `pdf-pages/` directory (e.g., `page-06.png`)
- **3D Renders**: PNG files in `generated/` directory (e.g., `page-06-render.png`)
- **Grouped Renders**: For multi-page rooms (e.g., `page-10-group-render.png`)
- **Debug Crops**: Optional crop previews for room identification debugging

## Configuration

### Room Identification

Adjust OCR parameters in `identifyRoomOptions`:

```javascript
{
  topCropRatio: 0.1,        // Top 10% of image to scan
  innerBandRatio: 0.2,      // Middle 20% of that band vertically
  innerWidthRatio: 0.25,    // Middle 25% horizontally
  minConfidence: 45,        // Minimum OCR confidence
  language: 'eng',          // OCR language
  previewCrop: false,       // Save debug crop images
  previewCropDir: 'debug'   // Directory for debug crops
}
```

### Description Generation

Customize GPT prompts in `describeOptions`:

```javascript
{
  prompt: 'Custom prompt...',  // Override default prompt
  apiKey: 'sk-...',            // Override API key
  keyFile: 'custom-key.txt'    // Custom key file
}
```

### Image Generation

Customize Gemini generation in `generateRoomImage`:

```javascript
{
  model: 'gemini-2.5-flash-image',  // Model to use
  negativePrompt: '...',            // Things to avoid
  apiKey: '...',                    // Override API key
  keyFile: 'custom-key.txt'         // Custom key file
}
```

## Troubleshooting

### Room Identification Issues

- **Wrong room names detected**: Adjust `topCropRatio`, `innerBandRatio`, or `innerWidthRatio` to target the correct text region
- **No room names found**: Lower `minConfidence` or check if the text is visible in the top section
- **Debug**: Enable `previewCrop: true` to see what region is being scanned

### Image Generation Issues

- **Missing furniture**: Check GPT description for accurate quantities and positions
- **Wrong layout**: Verify geometry JSON is being generated correctly
- **White space/labels**: The prompt has been optimized to avoid these; ensure you're using the latest version

### API Errors

- **OpenAI errors**: Verify your API key and check your usage limits
- **Gemini errors**: Verify your API key and ensure the model name is correct
- **Rate limiting**: Reduce `concurrency` to avoid hitting rate limits

## Dependencies

- `@google/genai`: Google Gemini API client
- `@napi-rs/canvas`: Canvas rendering for PDF conversion
- `openai`: OpenAI API client
- `pdfjs-dist`: PDF parsing and rendering
- `sharp`: Image processing
- `tesseract.js`: OCR for room identification

## License

ISC

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

