#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0bcdc3aefc95316b7c7e9051407e62ae8ff6d33f5f14327b5ac2069010ff4f9a/contract';
import startContract from '../../snapshots/0bcdc3aefc95316b7c7e9051407e62ae8ff6d33f5f14327b5ac2069010ff4f9a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c84e756f34f572a8c4416b4e090ab3421ecf633c84bb6264c3e0da7b06ce7b9c/contract';
import endContract from '../../snapshots/c84e756f34f572a8c4416b4e090ab3421ecf633c84bb6264c3e0da7b06ce7b9c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'agentRun',
        column: col('reservedCredits', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRun',
        column: col('settledCredits', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'toolInvocation',
        column: col('actualMicrocredits', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'toolInvocation',
        column: col('estimatedMicrocredits', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'toolInvocation',
        column: col('subModelId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'toolInvocation',
        column: col('waitpointToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'toolInvocation',
        index: 'toolInvocation_providerRunId_idx_c8aef772',
        columns: ['providerRunId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
