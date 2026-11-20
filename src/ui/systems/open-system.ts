// Opening one design system. The system page (U2) replaces this: until it lands a row says so, instead of doing nothing.

import { toast } from '../components/actions.ts';

export const openSystem = (_id: string): void => {
  toast('info', 'The design system page isn’t in this version yet. Your system is saved as a draft in the Designs folder.');
};
