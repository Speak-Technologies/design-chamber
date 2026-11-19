// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.9, §2.12, AD-29). T0 stub: T12a fills it.
// Build tickets (`<root>/.chamber/system-builds/`), consumed at adoption; Stop and its Undo.

import type { StopBuildResponse, SystemBuildTicketResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export type BuildTicket = { v: 1; ticket: string; created: string; projectDirectory: string | null; sessionId: string | null };

export type BuildTickets = {
  issue(input: { projectDirectory: string | null; sessionId: string | null }): Promise<BuildTicket>;
  get(ticket: string): Promise<SystemBuildTicketResponse>;
  linkSession(ticket: string, sessionId: string): Promise<void>;
  consume(ticket: string, systemId: string): Promise<void>;
  sweep(): Promise<void>;
  stop(id: string, input: { proposalId: string | null }): Promise<StopBuildResponse>;
  undoStop(undoId: string): Promise<{ id: string }>;
};

export const createBuildTickets = (ctx: ServiceContext): BuildTickets => notBuilt();
