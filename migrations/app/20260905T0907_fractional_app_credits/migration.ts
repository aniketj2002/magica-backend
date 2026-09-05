#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/3c8711d0f2fb7dfd63467e81840e7266d7a3c6cb44c5ec23dd17e52d3d412948/contract';
import endContract from '../../snapshots/3c8711d0f2fb7dfd63467e81840e7266d7a3c6cb44c5ec23dd17e52d3d412948/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c84e756f34f572a8c4416b4e090ab3421ecf633c84bb6264c3e0da7b06ce7b9c/contract';
import startContract from '../../snapshots/c84e756f34f572a8c4416b4e090ab3421ecf633c84bb6264c3e0da7b06ce7b9c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

/**
 * Int → numeric for app credit columns. Postgres casts losslessly via
 * `USING col::numeric`. Defaults stay `0` and match introspection.
 */
export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.alterColumnType({
        schema: 'public',
        table: 'agentRun',
        column: 'reservedCredits',
        options: {
          qualifiedTargetType: 'numeric',
          formatTypeExpected: 'numeric',
          rawTargetTypeForLabel: 'numeric',
        },
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'agentRun',
        column: 'settledCredits',
        options: {
          qualifiedTargetType: 'numeric',
          formatTypeExpected: 'numeric',
          rawTargetTypeForLabel: 'numeric',
        },
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'creditLedger',
        column: 'amount',
        options: {
          qualifiedTargetType: 'numeric',
          formatTypeExpected: 'numeric',
          rawTargetTypeForLabel: 'numeric',
        },
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'toolInvocation',
        column: 'actualCredits',
        options: {
          qualifiedTargetType: 'numeric',
          formatTypeExpected: 'numeric',
          rawTargetTypeForLabel: 'numeric',
        },
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'toolInvocation',
        column: 'estimatedCredits',
        options: {
          qualifiedTargetType: 'numeric',
          formatTypeExpected: 'numeric',
          rawTargetTypeForLabel: 'numeric',
        },
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'user',
        column: 'balance',
        options: {
          qualifiedTargetType: 'numeric',
          formatTypeExpected: 'numeric',
          rawTargetTypeForLabel: 'numeric',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
