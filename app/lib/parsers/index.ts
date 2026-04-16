import type { BankId, BankData } from '../types';
import type { BankEmail } from '../gmail';
import { parseAsb } from './asb';
import { parseBnz } from './bnz';
import { parseAnz } from './anz';
import { parseWestpac } from './westpac';
import { parseKiwibank } from './kiwibank';

export interface LabelMapping {
  label: string;       // Gmail label to scan
  bankId: BankId;
  textParser: (email: BankEmail) => Partial<BankData> | null;
  hasImageContent: boolean; // true ⇒ fall back to vision if no text data found
}

export const BANK_LABELS: LabelMapping[] = [
  { label: 'Bank Updates/ASB',      bankId: 'asb',      textParser: parseAsb,      hasImageContent: false },
  { label: 'Bank Updates/BNZ',      bankId: 'bnz',      textParser: parseBnz,      hasImageContent: true  },
  { label: 'Bank Updates/ANZ',      bankId: 'anz',      textParser: parseAnz,      hasImageContent: true  },
  { label: 'Bank Updates/Westpac',  bankId: 'westpac',  textParser: parseWestpac,  hasImageContent: true  },
  { label: 'Bank Updates/Kiwibank', bankId: 'kiwibank', textParser: parseKiwibank, hasImageContent: true  },
];
