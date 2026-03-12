import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Root route
app.get('/', (req, res) => {
  res.json({
    service: 'pdf-service',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      generatePdf: 'POST /api/generate-investment-direction'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'pdf-service' });
});

// PDF template URL
const PDF_URL = 'https://ohpjilsntlmlusgbpest.supabase.co/storage/v1/object/public/entrust-transfer-instructions/Investment%20Direction%20Precious%20Metals%20-%20Purchase%20&%20Exchange.pdf';

interface FormData {
  accountholderName: string;
  accountNumber: string;
  ssnEin: string;
  email: string;
  investmentType: 'purchase' | 'exchange' | null;
  purchaseAmount: string;
  dealerName: string;
  dealerRepName: string;
  dealerRepEmail: string;
  valueMetalsOutgoing: string;
  valueMetalsIncoming: string;
  additionalFunds: string;
  depository: 'delaware-de' | 'delaware-nv' | 'texas' | null;
  storageMethod: 'commingled' | 'segregated' | null;
  processingFee: 'deduct' | 'creditCard' | null;
  signatureDate: string;
}

// Create FDF content for pdftk
function createFdfContent(fields: Array<{ name: string; value: string }>): string {
  let fdfFields = '';
  for (const field of fields) {
    if (field.value) {
      const escapedValue = field.value
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
      fdfFields += `<</T(${field.name})/V(${escapedValue})>>\n`;
    }
  }

  return `%FDF-1.2
1 0 obj<</FDF<</Fields[
${fdfFields}]>>>>
endobj
trailer<</Root 1 0 R>>
%%EOF`;
}

// Generate PDF endpoint
app.post('/api/generate-investment-direction', async (req, res) => {
  const tempFiles: string[] = [];

  try {
    const { formData } = req.body as { formData: FormData };

    if (!formData) {
      return res.status(400).json({ error: 'Missing formData' });
    }

    // Download the PDF template
    const pdfResponse = await fetch(PDF_URL);
    if (!pdfResponse.ok) {
      throw new Error('Failed to fetch PDF template');
    }
    const pdfBytes = await pdfResponse.arrayBuffer();

    const tempId = randomUUID();
    const templatePath = join(tmpdir(), `investment-direction-${tempId}-template.pdf`);
    const fdfPath = join(tmpdir(), `investment-direction-${tempId}.fdf`);
    const filledPath = join(tmpdir(), `investment-direction-${tempId}-filled.pdf`);
    const outputPath = join(tmpdir(), `investment-direction-${tempId}-output.pdf`);
    tempFiles.push(templatePath, fdfPath, filledPath, outputPath);

    // Write template PDF
    await writeFile(templatePath, Buffer.from(pdfBytes));

    // Build field mappings
    const fields: Array<{ name: string; value: string }> = [
      // Text fields
      { name: 'Accountholder Name', value: formData.accountholderName || '' },
      { name: 'Account Number', value: formData.accountNumber || '' },
      { name: 'SSN  EIN Last 4 digits only', value: formData.ssnEin || '' },
      { name: 'Email', value: formData.email || '' },
      { name: 'Purchase Amount', value: formData.purchaseAmount || '' },
      { name: 'Dealer Name', value: formData.dealerName || '' },
      { name: 'Dealer Rep Name', value: formData.dealerRepName || '' },
      { name: 'Dealer Rep Email', value: formData.dealerRepEmail || '' },
      { name: 'Value of Metals Outgoing', value: formData.valueMetalsOutgoing || '' },
      { name: 'Value of Metals Incoming', value: formData.valueMetalsIncoming || '' },
      { name: 'Additional Funds to Be SentReceived if applicable', value: formData.additionalFunds || '' },
      // Hardcoded Citadel Gold wire transfer instructions
      { name: 'Bank Name', value: 'Wells Fargo Bank' },
      { name: 'Bank Phone', value: '(888) 384-8400' },
      { name: 'Bank City', value: 'San Francisco' },
      { name: 'Bank State', value: 'CA' },
      { name: 'ABA Routing  Must be 9 digits', value: '121000248' },
      { name: 'Name on Account', value: 'Citadel Gold LLC' },
      { name: 'Account', value: '5259127743' },
      { name: 'Address', value: '2029 Century Park E #400N' },
      { name: 'City', value: 'Los Angeles' },
      { name: 'State', value: 'CA' },
      { name: 'Zip', value: '90067' },
      { name: 'Date', value: formData.signatureDate || '' },
    ];

    // Add radio button fields with their PDF values
    if (formData.investmentType === 'purchase') {
      fields.push({ name: 'Investment_Direction', value: 'Purch' });
    } else if (formData.investmentType === 'exchange') {
      fields.push({ name: 'Investment_Direction', value: 'Exchange' });
    }

    if (formData.depository === 'delaware-de') {
      fields.push({ name: 'Depository_Election', value: 'DDSCD' });
    } else if (formData.depository === 'delaware-nv') {
      fields.push({ name: 'Depository_Election', value: 'DDSCN' });
    } else if (formData.depository === 'texas') {
      fields.push({ name: 'Depository_Election', value: 'TPMD' });
    }

    if (formData.storageMethod === 'segregated') {
      fields.push({ name: 'Storage', value: 'Seg' });
    } else if (formData.storageMethod === 'commingled') {
      fields.push({ name: 'Storage', value: 'Commingled' });
    }

    if (formData.processingFee === 'deduct') {
      fields.push({ name: 'Processing_Fees', value: 'Deduct' });
    } else if (formData.processingFee === 'creditCard') {
      fields.push({ name: 'Processing_Fees', value: 'CConFile' });
    }

    // Create FDF file
    const fdfContent = createFdfContent(fields);
    await writeFile(fdfPath, fdfContent);

    // Fill the PDF with pdftk
    await execAsync(`pdftk "${templatePath}" fill_form "${fdfPath}" output "${filledPath}"`);

    // Flatten the PDF with pdftk
    await execAsync(`pdftk "${filledPath}" output "${outputPath}" flatten`);

    // Read the final PDF
    const finalPdfBytes = await readFile(outputPath);

    // Clean up temp files
    for (const file of tempFiles) {
      try {
        await unlink(file);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Return PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Investment_Direction_${(formData.accountholderName || 'Form').replace(/\s+/g, '_')}.pdf"`
    );
    res.send(finalPdfBytes);
  } catch (error) {
    // Clean up temp files on error
    for (const file of tempFiles) {
      try {
        await unlink(file);
      } catch {
        // Ignore cleanup errors
      }
    }

    console.error('Error generating PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to generate PDF', details: errorMessage });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`PDF Service running on port ${PORT}`);
});
