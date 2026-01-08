const ExcelJS = require('exceljs');
const vCard = require('vcf');
const { parse } = require('csv-parse/sync');

class ContactsService {
  /**
   * Parse uploaded contact file and extract contact data
   * @param {Buffer} fileBuffer
   * @param {string} filename
   * @returns {Promise<Array>}
   */
  async parseContactFile(fileBuffer, filename) {
    const extension = filename.split('.').pop()?.toLowerCase();

    switch (extension) {
      case 'csv':
        return this.parseCSV(fileBuffer);
      case 'vcf':
        return this.parseVCF(fileBuffer);
      case 'xlsx':
      case 'xls':
        return this.parseExcel(fileBuffer);
      default:
        throw new Error(`Unsupported file format: ${extension}`);
    }
  }

  parseCSV(buffer) {
    const content = buffer.toString('utf-8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records
      .map((row) => ({
        name: row.name || row.Name || row.full_name || row.FullName || '',
        phone_number: this.normalizePhone(
          row.phone ||
          row.Phone ||
          row.phone_number ||
          row.PhoneNumber ||
          ''
        ),
        email: row.email || row.Email || '',
        company: row.company || row.Company || '',
        notes: row.notes || row.Notes || '',
        metadata: {},
      }))
      .filter((contact) => contact.phone_number);
  }

  parseVCF(buffer) {
    const content = buffer.toString('utf-8');
    const cards = vCard.parse(content) || [];

    return cards
      .map((card) => {
        const phoneValue = card.get('tel')?.valueOf();
        let phone = '';

        if (Array.isArray(phoneValue)) {
          phone = phoneValue[0] || '';
        } else if (phoneValue && typeof phoneValue === 'object' && phoneValue.value) {
          phone = phoneValue.value;
        } else {
          phone = phoneValue || '';
        }

        return {
          name: card.get('fn')?.valueOf() || '',
          phone_number: this.normalizePhone(phone),
          email: this.extractField(card.get('email')),
          company: this.extractField(card.get('org')),
          notes: this.extractField(card.get('note')),
          metadata: {},
        };
      })
      .filter((contact) => contact.phone_number);
  }

  async parseExcel(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      return [];
    }

    const contacts = [];
    const headers = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell((cell) => {
          headers.push(cell.value?.toString().toLowerCase());
        });
        return;
      }

      const contactRow = {};
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1];
        if (header) {
          contactRow[header] = cell.value?.toString() || '';
        }
      });

      contacts.push({
        name: contactRow.name || contactRow.full_name || '',
        phone_number: this.normalizePhone(
          contactRow.phone ||
            contactRow.phone_number ||
            contactRow.phoneNumber ||
            ''
        ),
        email: contactRow.email || '',
        company: contactRow.company || '',
        notes: contactRow.notes || '',
        metadata: {},
      });
    });

    return contacts.filter((contact) => contact.phone_number);
  }

  normalizePhone(phone) {
    if (!phone || typeof phone !== 'string') {
      return '';
    }

    // Remove all non-digit characters except leading +
    return phone
      .trim()
      .replace(/[^\d+]/g, '')
      .replace(/(?!^)\+/g, '');
  }

  extractField(field) {
    if (!field) return '';
    const value = field.valueOf();

    if (Array.isArray(value)) {
      return value[0] || '';
    }

    if (value && typeof value === 'object' && value.value) {
      return value.value;
    }

    return value || '';
  }
}

module.exports = new ContactsService();

