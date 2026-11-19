// Phase 2.5 (documentation/specs/phase-2-5-technical.md §7.1 to §7.4). T0 stub: T4 (S8 purposes and the repo flavour: T13) fills it.
// Scan jobs over a project folder with the bounded walker; never writes the project.

import type { CreateSystemScanBody, SystemScanResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export type ScanJobs = {
  start(input: CreateSystemScanBody): Promise<{ scanId: string }>;
  get(scanId: string): SystemScanResponse;
  cancel(scanId: string): void;
};

export const createScanJobs = (ctx: ServiceContext): ScanJobs => notBuilt();
