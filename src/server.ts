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
      generateInvestmentDirection: 'POST /api/generate-investment-direction',
      generateDistributionForm: 'POST /api/generate-distribution-form'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'pdf-service' });
});

// PDF template URLs
const INVESTMENT_DIRECTION_PDF_URL = 'https://ohpjilsntlmlusgbpest.supabase.co/storage/v1/object/public/entrust-transfer-instructions/Investment%20Direction%20Precious%20Metals%20-%20Purchase%20&%20Exchange.pdf';
const DISTRIBUTION_FORM_PDF_URL = 'https://ohpjilsntlmlusgbpest.supabase.co/storage/v1/object/public/entrust-transfer-instructions/Precious_Metals_Distribution_Form_Jan-26.pdf';

interface InvestmentDirectionFormData {
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

interface DistributionFormData {
  // Section 1 - Account Owner Information
  accountName: string;
  entrustAccountNumber: string;
  accountType: string;
  email: string;
  daytimePhone: string;

  // Death Distribution
  isDeathDistribution: boolean | null;
  beneficiaryName: string;
  beneficiarySsn: string;
  beneficiaryDob: string;
  beneficiaryPhone: string;
  beneficiaryAddress: string;
  beneficiaryCityStateZip: string;

  // Section 2 - Distribution Type
  distributionCategory: 'ira' | 'specialPurpose' | null;

  // IRA - Traditional/SEP/SIMPLE
  iraTraditionalType: 'normal' | 'premature' | 'dueToDeath' | 'directRollover' | 'qcd' | null;
  iraTraditionalDeathOption: 'transferBeneficiaryIra' | 'transferOwnIra' | 'distributionToBeneficiary' | null;

  // IRA - Roth
  iraRothType: 'qualified' | 'nonQualified' | 'dueToDeath' | null;
  iraRothNonQualifiedOption: 'underAge' | 'overAgeNotSatisfied' | null;
  iraRothDeathOption: 'transferBeneficiaryIra' | 'transferOwnIra' | 'distributionToBeneficiary' | null;
  iraRothHoldingPeriodSatisfied: boolean | null;

  // Miscellaneous
  excessContribution: boolean;
  excessContributionYear: string;
  excessContributionAmount: string;
  divorceLegalSeparation: boolean;

  // Special Purpose Plan
  specialPurposeType: 'hsaDistribution' | 'hsaExcess' | 'hsaDeath' | 'coverdellDistribution' | 'coverdellExcess' | 'coverdellDeath' | 'coverdellTransfer' | null;
  coverdellEligibleFamilyMember: boolean;

  // Section 3 - Distribution Details
  distributionMethod: 'full' | 'partial' | null;
  partialCashAmount: string;
  partialInKind: boolean;
  inKindAssets: string;

  // Recurring Distribution
  recurringDistribution: boolean | null;
  recurringFrequency: 'monthly' | 'quarterly' | 'semiAnnually' | 'annually' | null;
  recurringStartDate: string;

  // Section 4 - Tax Withholding
  federalWithholding: 'none' | 'percentage' | null;
  federalWithholdingPercent: string;
  stateWithholding: 'none' | 'percentage' | null;
  stateWithholdingPercent: string;

  // Section 5 - Cash Distribution Funding
  fundingMethod: 'wire' | 'check' | 'ach' | null;

  // Wire/ACH fields
  wirePayeeName: string;
  wireBankName: string;
  wireForFurtherCredit: string;
  wireRoutingNumber: string;
  wireAccountNumber: string;
  wirePayeeAddress: string;
  wireCity: string;
  wireState: string;
  wireZip: string;
  wireAdditionalInfo: string;

  // Check fields
  checkPayeeName: string;
  checkPayeePhone: string;
  checkPayeeAddress: string;
  checkPayeeCityStateZip: string;
  checkMailToDifferent: boolean;
  checkMailToName: string;
  checkMailToPhone: string;
  checkMailToAddress: string;
  checkMailToCityStateZip: string;
  checkMailToReason: string;
  checkSendVia: 'regularMail' | 'overnight' | null;
  checkOvernightBilling: 'entrustAccount' | 'thirdParty' | null;
  checkOvernightCarrier: 'fedex' | 'ups' | null;
  checkOvernightAccountNumber: string;

  // Section 6 - In-Kind Distribution
  inKindPayeeName: string;
  inKindPayeePhone: string;
  inKindPayeeAddress: string;
  inKindPayeeCityStateZip: string;
  inKindSendToDifferent: boolean;
  inKindSendToName: string;
  inKindSendToPhone: string;
  inKindSendToAddress: string;
  inKindSendToCityStateZip: string;
  inKindSendToReason: string;
  inKindDeliverySpeed: 'overnight' | 'twoDay' | 'ground' | null;
  inKindAdditionalInfo: string;

  // Section 7 - Fee Payment Method
  feePaymentMethod: 'entrustAccount' | 'creditCard' | 'thirdPartyBilling' | null;
  feeThirdPartyCarrier: 'fedex' | 'ups' | null;
  feeThirdPartyAccountNumber: string;

  // Section 8 - Signature
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

// Generate Investment Direction PDF endpoint
app.post('/api/generate-investment-direction', async (req, res) => {
  const tempFiles: string[] = [];

  try {
    const { formData } = req.body as { formData: InvestmentDirectionFormData };

    if (!formData) {
      return res.status(400).json({ error: 'Missing formData' });
    }

    // Download the PDF template
    const pdfResponse = await fetch(INVESTMENT_DIRECTION_PDF_URL);
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

// Generate Distribution Form PDF endpoint
app.post('/api/generate-distribution-form', async (req, res) => {
  const tempFiles: string[] = [];

  try {
    const { formData } = req.body as { formData: DistributionFormData };

    if (!formData) {
      return res.status(400).json({ error: 'Missing formData' });
    }

    // Download the PDF template
    const pdfResponse = await fetch(DISTRIBUTION_FORM_PDF_URL);
    if (!pdfResponse.ok) {
      throw new Error('Failed to fetch PDF template');
    }
    const pdfBytes = await pdfResponse.arrayBuffer();

    const tempId = randomUUID();
    const templatePath = join(tmpdir(), `distribution-form-${tempId}-template.pdf`);
    const fdfPath = join(tmpdir(), `distribution-form-${tempId}.fdf`);
    const filledPath = join(tmpdir(), `distribution-form-${tempId}-filled.pdf`);
    const outputPath = join(tmpdir(), `distribution-form-${tempId}-output.pdf`);
    tempFiles.push(templatePath, fdfPath, filledPath, outputPath);

    // Write template PDF
    await writeFile(templatePath, Buffer.from(pdfBytes));

    // Build field mappings
    const fields: Array<{ name: string; value: string }> = [];

    // Section 1 - Account Owner Information
    fields.push({ name: 'NAME_ON_ACCT', value: formData.accountName || '' });
    fields.push({ name: 'ENTRUST_ACCT_NUMBER', value: formData.entrustAccountNumber || '' });
    fields.push({ name: 'ACCT_TYPE', value: formData.accountType || '' });
    fields.push({ name: 'EMAIL', value: formData.email || '' });
    fields.push({ name: 'DAYTIME_PH_NUMBER', value: formData.daytimePhone || '' });

    // Death Distribution
    if (formData.isDeathDistribution === true) {
      fields.push({ name: 'DUE_TO_DEATH', value: '1' }); // Yes
      fields.push({ name: 'BENEFICIARY_NAME', value: formData.beneficiaryName || '' });
      fields.push({ name: 'BENEFICIARY_SSN', value: formData.beneficiarySsn || '' });
      fields.push({ name: 'BENEFICIARY_DOB', value: formData.beneficiaryDob || '' });
      fields.push({ name: 'BENEFICIARY_PH_NUMBER', value: formData.beneficiaryPhone || '' });
      fields.push({ name: 'BENEFICIARY_ADDRESS', value: formData.beneficiaryAddress || '' });
      fields.push({ name: 'BENEFICIARY_CITY_STATE_ZIPCODE', value: formData.beneficiaryCityStateZip || '' });
    } else if (formData.isDeathDistribution === false) {
      fields.push({ name: 'DUE_TO_DEATH', value: '2' }); // No
    }

    // Section 2 - Distribution Type
    // Map distribution types to checkbox values (1-16 based on the PDF)
    // Distribution Type Box values: 1-16
    // 1 = Normal Distribution, 2 = Premature, 3 = Due to Death (Traditional), 4 = Direct Rollover
    // 5 = QCD, 6 = Qualified (Roth), 7 = Non-Qualified (Roth), 8 = Due to Death (Roth)
    // 9 = Excess Contribution, 10 = Divorce, 11 = HSA Distribution, 12 = HSA Excess
    // 13 = HSA Due to Death, 14 = Coverdell Distribution, 15 = Coverdell Excess
    // 16 = Coverdell Due to Death, 17 = Coverdell Transfer
    if (formData.distributionCategory === 'ira') {
      if (formData.iraTraditionalType === 'normal') {
        fields.push({ name: 'Distribution Type Box', value: '1' });
      } else if (formData.iraTraditionalType === 'premature') {
        fields.push({ name: 'Distribution Type Box', value: '2' });
      } else if (formData.iraTraditionalType === 'dueToDeath') {
        fields.push({ name: 'Distribution Type Box', value: '3' });
        // Sub-options for Due to Death Traditional
        if (formData.iraTraditionalDeathOption === 'transferBeneficiaryIra') {
          fields.push({ name: 'Due to Death Traditional Box', value: '1' });
        } else if (formData.iraTraditionalDeathOption === 'transferOwnIra') {
          fields.push({ name: 'Due to Death Traditional Box', value: '2' });
        } else if (formData.iraTraditionalDeathOption === 'distributionToBeneficiary') {
          fields.push({ name: 'Due to Death Traditional Box', value: '3' });
        }
      } else if (formData.iraTraditionalType === 'directRollover') {
        fields.push({ name: 'Distribution Type Box', value: '4' });
      } else if (formData.iraTraditionalType === 'qcd') {
        fields.push({ name: 'Distribution Type Box', value: '5' });
      }

      // Roth options
      if (formData.iraRothType === 'qualified') {
        fields.push({ name: 'Distribution Type Box', value: '6' });
      } else if (formData.iraRothType === 'nonQualified') {
        fields.push({ name: 'Distribution Type Box', value: '7' });
        // Non-Qualified Type Box
        if (formData.iraRothNonQualifiedOption === 'underAge') {
          fields.push({ name: 'Non-Qualified Type Box', value: '1' });
        } else if (formData.iraRothNonQualifiedOption === 'overAgeNotSatisfied') {
          fields.push({ name: 'Non-Qualified Type Box', value: '2' });
        }
      } else if (formData.iraRothType === 'dueToDeath') {
        fields.push({ name: 'Distribution Type Box', value: '8' });
        // Due to Death Type Box (Roth)
        if (formData.iraRothDeathOption === 'transferBeneficiaryIra') {
          fields.push({ name: 'Due to Death Type Box', value: '1' });
        } else if (formData.iraRothDeathOption === 'transferOwnIra') {
          fields.push({ name: 'Due to Death Type Box', value: '2' });
        } else if (formData.iraRothDeathOption === 'distributionToBeneficiary') {
          fields.push({ name: 'Due to Death Type Box', value: '3' });
        }
        // 5-Year Holding Period
        if (formData.iraRothHoldingPeriodSatisfied === true) {
          fields.push({ name: '5-Year Holding Satisfied Box', value: '1' });
        } else if (formData.iraRothHoldingPeriodSatisfied === false) {
          fields.push({ name: '5-Year Holding Satisfied Box', value: '2' });
        }
      }

      // Miscellaneous
      if (formData.excessContribution) {
        fields.push({ name: 'Distribution Type Box', value: '9' });
        fields.push({ name: 'Year of excess contribution', value: formData.excessContributionYear || '' });
        fields.push({ name: 'Amount', value: formData.excessContributionAmount || '' });
      }
      if (formData.divorceLegalSeparation) {
        fields.push({ name: 'Distribution Type Box', value: '10' });
      }
    }

    // Special Purpose Plan
    if (formData.distributionCategory === 'specialPurpose') {
      if (formData.specialPurposeType === 'hsaDistribution') {
        fields.push({ name: 'Distribution Type Box', value: '11' });
      } else if (formData.specialPurposeType === 'hsaExcess') {
        fields.push({ name: 'Distribution Type Box', value: '12' });
      } else if (formData.specialPurposeType === 'hsaDeath') {
        fields.push({ name: 'Distribution Type Box', value: '13' });
      } else if (formData.specialPurposeType === 'coverdellDistribution') {
        fields.push({ name: 'Distribution Type Box', value: '14' });
      } else if (formData.specialPurposeType === 'coverdellExcess') {
        fields.push({ name: 'Distribution Type Box', value: '15' });
      } else if (formData.specialPurposeType === 'coverdellDeath') {
        fields.push({ name: 'Distribution Type Box', value: '16' });
      } else if (formData.specialPurposeType === 'coverdellTransfer') {
        fields.push({ name: 'Distribution Type Box', value: '17' });
        if (formData.coverdellEligibleFamilyMember) {
          fields.push({ name: 'ELIGIBLE FAMILY MEMBER', value: 'On' });
        }
      }
    }

    // Section 3 - Distribution Details
    if (formData.distributionMethod === 'full') {
      fields.push({ name: 'Full or Partial Distribution', value: '1' });
    } else if (formData.distributionMethod === 'partial') {
      fields.push({ name: 'Full or Partial Distribution', value: '2' });

      if (formData.partialCashAmount) {
        fields.push({ name: 'CASH_ONLY_CH', value: 'On' });
        fields.push({ name: 'CASH_AMOUNT', value: formData.partialCashAmount || '' });
      }

      if (formData.partialInKind) {
        fields.push({ name: 'INKIND_ASSET_CH', value: 'On' });
        // Split in-kind assets across multiple lines
        const assetLines = formData.inKindAssets?.split('\n') || [];
        if (assetLines[0]) fields.push({ name: 'INKIND_ASSET', value: assetLines[0] || '' });
        if (assetLines[1]) fields.push({ name: 'INKIND_ASSET_2', value: assetLines[1] || '' });
        if (assetLines[2]) fields.push({ name: 'INKIND_ASSET_3', value: assetLines[2] || '' });
        if (assetLines[3]) fields.push({ name: 'INKIND_ASSET_4', value: assetLines[3] || '' });
        if (assetLines[4]) fields.push({ name: 'INKIND_ASSET_5', value: assetLines[4] || '' });
      }
    }

    // Recurring Distribution
    if (formData.recurringDistribution === true) {
      fields.push({ name: 'Recurring Distribution?', value: '1' }); // Yes
      if (formData.recurringFrequency === 'monthly') {
        fields.push({ name: 'If Recurring, Schedule?', value: '1' });
      } else if (formData.recurringFrequency === 'quarterly') {
        fields.push({ name: 'If Recurring, Schedule?', value: '2' });
      } else if (formData.recurringFrequency === 'semiAnnually') {
        fields.push({ name: 'If Recurring, Schedule?', value: '3' });
      } else if (formData.recurringFrequency === 'annually') {
        fields.push({ name: 'If Recurring, Schedule?', value: '4' });
      }
      fields.push({ name: 'Date Payments to Commence', value: formData.recurringStartDate || '' });
    } else if (formData.recurringDistribution === false) {
      fields.push({ name: 'Recurring Distribution?', value: '2' }); // No
    }

    // Section 4 - Tax Withholding
    if (formData.federalWithholding === 'none') {
      fields.push({ name: 'Federal Witholding Box', value: '1' });
    } else if (formData.federalWithholding === 'percentage') {
      fields.push({ name: 'Federal Witholding Box', value: '2' });
      fields.push({ name: 'FEDERAL INCOME TAX WITHHELD', value: formData.federalWithholdingPercent || '' });
    }

    if (formData.stateWithholding === 'none') {
      fields.push({ name: 'State Witholding Box', value: '1' });
    } else if (formData.stateWithholding === 'percentage') {
      fields.push({ name: 'State Witholding Box', value: '2' });
      fields.push({ name: 'STATE INCOME TAX WITHHELD3', value: formData.stateWithholdingPercent || '' });
    }

    // Section 5 - Funding Method
    if (formData.fundingMethod === 'wire') {
      fields.push({ name: 'Funding Method', value: '1' });
    } else if (formData.fundingMethod === 'check') {
      fields.push({ name: 'Funding Method', value: '2' });
    } else if (formData.fundingMethod === 'ach') {
      fields.push({ name: 'Funding Method', value: '3' });
    }

    // Wire/ACH fields
    if (formData.fundingMethod === 'wire' || formData.fundingMethod === 'ach') {
      fields.push({ name: 'PAYEE NAME', value: formData.wirePayeeName || '' });
      fields.push({ name: 'BANK NAME', value: formData.wireBankName || '' });
      fields.push({ name: 'FOR FURTHER CREDIT TO', value: formData.wireForFurtherCredit || '' });
      fields.push({ name: 'BANK ABA  ROUTING NUMBER', value: formData.wireRoutingNumber || '' });
      fields.push({ name: 'ACCOUNT NUMBER', value: formData.wireAccountNumber || '' });
      fields.push({ name: 'PAYEE STREET ADDRESS', value: formData.wirePayeeAddress || '' });
      fields.push({ name: 'CITY', value: formData.wireCity || '' });
      fields.push({ name: 'STATE', value: formData.wireState || '' });
      fields.push({ name: 'ZIP CODE', value: formData.wireZip || '' });
      fields.push({ name: 'ADDITIONAL INFORMATION_2', value: formData.wireAdditionalInfo || '' });
    }

    // Check fields
    if (formData.fundingMethod === 'check') {
      fields.push({ name: 'PAYEE NAME_2', value: formData.checkPayeeName || '' });
      fields.push({ name: 'PHONE NUMBER for overnight delivery', value: formData.checkPayeePhone || '' });
      fields.push({ name: 'PAYEE STREET ADDRESS_2', value: formData.checkPayeeAddress || '' });
      fields.push({ name: 'CITY_2', value: formData.checkPayeeCityStateZip || '' });

      if (formData.checkMailToDifferent) {
        fields.push({ name: 'Check Mail To If Different From Payee Address', value: 'On' });
        fields.push({ name: 'NAME', value: formData.checkMailToName || '' });
        fields.push({ name: 'PHONE NUMBER for overnight delivery_3', value: formData.checkMailToPhone || '' });
        fields.push({ name: 'STREET ADDRESS', value: formData.checkMailToAddress || '' });
        fields.push({ name: 'CITY_3', value: formData.checkMailToCityStateZip || '' });
        fields.push({ name: 'REASON FOR SHIPPING TO NON-PAYEE', value: formData.checkMailToReason || '' });
      }

      if (formData.checkSendVia === 'regularMail') {
        fields.push({ name: 'Check Delivery Preference', value: '1' });
      } else if (formData.checkSendVia === 'overnight') {
        fields.push({ name: 'Check Delivery Preference', value: '2' });
        if (formData.checkOvernightBilling === 'entrustAccount') {
          fields.push({ name: 'Overnight Billing Preference', value: '1' });
        } else if (formData.checkOvernightBilling === 'thirdParty') {
          fields.push({ name: 'Overnight Billing Preference', value: '2' });
          if (formData.checkOvernightCarrier === 'fedex') {
            fields.push({ name: 'Third-Party Billing for Overnight Check', value: '1' });
          } else if (formData.checkOvernightCarrier === 'ups') {
            fields.push({ name: 'Third-Party Billing for Overnight Check', value: '2' });
          }
          fields.push({ name: 'Third-Party Account # for Overnight Check', value: formData.checkOvernightAccountNumber || '' });
        }
      }
    }

    // Section 6 - In-Kind Distribution
    fields.push({ name: 'PAYEE NAME_3', value: formData.inKindPayeeName || '' });
    fields.push({ name: 'PAYEE PHONE NUMBER', value: formData.inKindPayeePhone || '' });
    fields.push({ name: 'PAYEE STREET ADDRESS_3', value: formData.inKindPayeeAddress || '' });
    fields.push({ name: 'CITY_4', value: formData.inKindPayeeCityStateZip || '' });

    if (formData.inKindSendToDifferent) {
      fields.push({ name: 'Check Mail To If Different From Payee Address_3', value: 'On' });
      fields.push({ name: 'NAME_3', value: formData.inKindSendToName || '' });
      fields.push({ name: 'PAYEE PHONE NUMBER_3', value: formData.inKindSendToPhone || '' });
      fields.push({ name: 'STREET ADDRESS_2', value: formData.inKindSendToAddress || '' });
      fields.push({ name: 'CITY_5', value: formData.inKindSendToCityStateZip || '' });
      fields.push({ name: 'REASON FOR SHIPPING TO NON-PAYEE 2', value: formData.inKindSendToReason || '' });
    }

    if (formData.inKindDeliverySpeed === 'overnight') {
      fields.push({ name: 'Delivery Speed Option', value: '1' });
    } else if (formData.inKindDeliverySpeed === 'twoDay') {
      fields.push({ name: 'Delivery Speed Option', value: '2' });
    } else if (formData.inKindDeliverySpeed === 'ground') {
      fields.push({ name: 'Delivery Speed Option', value: '3' });
    }

    fields.push({ name: 'ADDITIONAL INFO 4', value: formData.inKindAdditionalInfo || '' });

    // Section 7 - Fee Payment Method
    if (formData.feePaymentMethod === 'entrustAccount') {
      fields.push({ name: 'Fee Payment Method', value: '1' });
    } else if (formData.feePaymentMethod === 'creditCard') {
      fields.push({ name: 'Fee Payment Method', value: '2' });
    } else if (formData.feePaymentMethod === 'thirdPartyBilling') {
      fields.push({ name: 'Fee Payment Method', value: '3' });
      if (formData.feeThirdPartyCarrier === 'fedex') {
        fields.push({ name: '3rd Party Billing', value: '1' });
      } else if (formData.feeThirdPartyCarrier === 'ups') {
        fields.push({ name: '3rd Party Billing', value: '2' });
      }
      fields.push({ name: '3rd Party Billing Account #', value: formData.feeThirdPartyAccountNumber || '' });
    }

    // Section 8 - Signature Date
    fields.push({ name: 'DATE', value: formData.signatureDate || '' });

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
      `attachment; filename="Distribution_Form_${(formData.accountName || 'Form').replace(/\s+/g, '_')}.pdf"`
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
