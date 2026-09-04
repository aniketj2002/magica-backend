#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2467add676c661481cef76a808f76704ab187f07403493e5e2acc74a2803c25a/contract';
import endContract from '../../snapshots/2467add676c661481cef76a808f76704ab187f07403493e5e2acc74a2803c25a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a3843bbdcda38ef4c59d1cfd056e92647d1545fceac5af64a6aabea59df4b364/contract';
import startContract from '../../snapshots/a3843bbdcda38ef4c59d1cfd056e92647d1545fceac5af64a6aabea59df4b364/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'agentRun',
        column: col('heartbeatAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRun',
        column: col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRun',
        column: col('triggerRunId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'agentRun',
        column: col('turnCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'chat',
        column: col('activeRunId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'message',
        column: col('agentRunId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'agentRun',
        constraint: 'agentRun_idempotencyKey_key',
        columns: ['idempotencyKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'chat',
        constraint: 'chat_activeRunId_key',
        columns: ['activeRunId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentRun',
        index: 'agentRun_chatId_status_idx_65a3df10',
        columns: ['chatId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message',
        index: 'message_agentRunId_idx_1f80425e',
        columns: ['agentRunId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message',
        index: 'message_chatId_createdAt_id_idx_b3ce5307',
        columns: ['chatId', 'createdAt', 'id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message',
        foreignKey: {
          name: 'message_agentRunId_fkey',
          columns: ['agentRunId'],
          references: { schema: 'public', table: 'agentRun', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
