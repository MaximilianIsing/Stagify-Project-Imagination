# PDF Processing Server API

A REST API server for processing PDF floorplans into 3D visualizations.

## Endpoints

### Health Check
```
GET /health
```
Returns server status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-XX..."
}
```

### Process PDF
```
POST /process
```
Processes a PDF file and returns the generated merged PDF.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: Form data with field name `pdf` containing the PDF file

**Query Parameters (optional):**
- `skipConversion` (number): Skip first N pages during conversion (default: 4)
- `skip` (number): Skip first N pages during processing (default: 0)
- `concurrency` (number): Number of rooms to process in parallel (default: 2)
- `continue` (boolean): Continue on error (default: false)
- `dpi` (number): DPI for PDF to PNG conversion (default: 110)
- `merge` (boolean): Merge output images into PDF (default: true)
- `filename` (string): Custom filename for output PDF (default: auto-generated)

**Response:**
- Success: PDF file (Content-Type: `application/pdf`)
- Error: JSON error object

**Example using curl:**
```bash
curl -X POST \
  "https://your-server.onrender.com/process?skipConversion=4&concurrency=2" \
  -F "pdf=@your-floorplan.pdf" \
  -o output.pdf
```

**Example using JavaScript (fetch):**
```javascript
const formData = new FormData();
formData.append('pdf', pdfFile);

const response = await fetch('https://your-server.onrender.com/process?skipConversion=4&concurrency=2', {
  method: 'POST',
  body: formData
});

if (response.ok) {
  const blob = await response.blob();
  // Save or use the PDF blob
} else {
  const error = await response.json();
  console.error('Error:', error);
}
```

**Example using Python (requests):**
```python
import requests

url = "https://your-server.onrender.com/process"
params = {
    "skipConversion": 4,
    "concurrency": 2
}

with open("floorplan.pdf", "rb") as f:
    files = {"pdf": f}
    response = requests.post(url, files=files, params=params)
    
    if response.status_code == 200:
        with open("output.pdf", "wb") as out:
            out.write(response.content)
    else:
        print("Error:", response.json())
```

## Error Responses

**400 Bad Request:**
```json
{
  "error": "No PDF file uploaded"
}
```

**400 Bad Request (file too large):**
```json
{
  "error": "File too large. Maximum size is 100MB"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Failed to process PDF",
  "message": "Error details...",
  "requestId": "1234567890-abc123"
}
```

## Deployment on Render.com

1. Connect your GitHub repository to Render
2. Create a new Web Service
3. Set the following:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
   - **Health Check Path:** `/health`

4. Add environment variables in Render dashboard:
   - `OPENAI_API_KEY` (for GPT descriptions)
   - `GEMINI_API_KEY` (for image generation)
   - Or use the key files (key.txt, gpt-key.txt) in your repository

5. Recommended instance size:
   - **Starter:** 512MB RAM (for testing)
   - **Standard:** 1GB+ RAM (recommended for production)
   - **Pro:** 2GB+ RAM (for high concurrency)

## Notes

- Maximum file size: 100MB
- Processing time depends on PDF size and number of pages
- Temporary files are automatically cleaned up after processing
- The server processes PDFs asynchronously and returns the merged PDF when complete

