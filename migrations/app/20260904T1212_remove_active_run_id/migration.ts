#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2467add676c661481cef76a808f76704ab187f07403493e5e2acc74a2803c25a/contract';
import startContract from '../../snapshots/2467add676c661481cef76a808f76704ab187f07403493e5e2acc74a2803c25a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/55e2197bf1b2c16f0d0b8a274b165630e43beb08833cadeae6ab958a7b1ff52a/contract';
import endContract from '../../snapshots/55e2197bf1b2c16f0d0b8a274b165630e43beb08833cadeae6ab958a7b1ff52a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({ schema: 'public', table: 'chat', constraint: 'chat_activeRunId_key' }),
      this.dropColumn({ schema: 'public', table: 'chat', column: 'activeRunId' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
