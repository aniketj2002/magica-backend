#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0bcdc3aefc95316b7c7e9051407e62ae8ff6d33f5f14327b5ac2069010ff4f9a/contract';
import endContract from '../../snapshots/0bcdc3aefc95316b7c7e9051407e62ae8ff6d33f5f14327b5ac2069010ff4f9a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/55e2197bf1b2c16f0d0b8a274b165630e43beb08833cadeae6ab958a7b1ff52a/contract';
import startContract from '../../snapshots/55e2197bf1b2c16f0d0b8a274b165630e43beb08833cadeae6ab958a7b1ff52a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
