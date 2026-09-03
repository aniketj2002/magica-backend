#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a3843bbdcda38ef4c59d1cfd056e92647d1545fceac5af64a6aabea59df4b364/contract';
import endContract from '../../snapshots/a3843bbdcda38ef4c59d1cfd056e92647d1545fceac5af64a6aabea59df4b364/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'agentRun',
        columns: [
          col('chatId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('completedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('completionTokens', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('messageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('modelActual', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('modelRequested', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('promptTokens', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('startedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('totalTokens', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('triggerTaskId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'agentRun_status_check_e2d659f6',
            "\"status\" IN ('QUEUED', 'RUNNING', 'WAITING', 'STOPPING', 'COMPLETED', 'FAILED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'attachment',
        columns: [
          col('chatId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('messageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('mimeType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('originalName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resultUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sizeBytes', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('storageKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('storageProvider', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('transloaditAssemblyId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'attachment_status_check_c1fe55c3',
            "\"status\" IN ('PENDING', 'UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'chat',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'creditLedger',
        columns: [
          col('agentRunId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('amount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('toolInvocationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'creditLedger_type_check_0e255e2a',
            "\"type\" IN ('RESERVATION', 'RELEASE', 'CHARGE', 'REFUND', 'ADJUSTMENT')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'generatedAsset',
        columns: [
          col('chatId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('messageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('mimeType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sizeBytes', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('sourceUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('storageKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('storageProvider', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('toolInvocationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'generatedAsset_type_check_840b43a3',
            "\"type\" IN ('IMAGE', 'VIDEO', 'AUDIO')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'message',
        columns: [
          col('chatId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('content', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'message_role_check_6368b6bd',
            "\"role\" IN ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL')",
          ),
          checkExpression(
            'message_status_check_8fcf3117',
            "\"status\" IN ('PENDING', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'runSkill',
        columns: [
          col('agentRunId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('contentHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('loadedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('skillName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'toolInvocation',
        columns: [
          col('actualCredits', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('agentRunId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('chatId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('completedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('durationMs', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('estimatedCredits', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotencyKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('input', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('messageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('output', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('provider', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('providerRunId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('toolName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'toolInvocation_status_check_be53ae1d',
            "\"status\" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'user',
        columns: [
          col('clerkId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('email', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'waitpoint',
        columns: [
          col('agentRunId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('input', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('response', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('resumedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('token', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'waitpoint_status_check_2e97c9ea',
            "\"status\" IN ('PENDING', 'RESUMED', 'EXPIRED', 'CANCELLED')",
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'creditLedger',
        constraint: 'creditLedger_idempotencyKey_key',
        columns: ['idempotencyKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'runSkill',
        constraint: 'runSkill_agentRunId_skillName_key',
        columns: ['agentRunId', 'skillName'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'toolInvocation',
        constraint: 'toolInvocation_idempotencyKey_key',
        columns: ['idempotencyKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'user',
        constraint: 'user_clerkId_key',
        columns: ['clerkId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'waitpoint',
        constraint: 'waitpoint_token_key',
        columns: ['token'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentRun',
        index: 'agentRun_chatId_idx_53965835',
        columns: ['chatId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentRun',
        index: 'agentRun_messageId_idx_3cdded8d',
        columns: ['messageId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'agentRun',
        index: 'agentRun_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'attachment',
        index: 'attachment_chatId_idx_53965835',
        columns: ['chatId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'attachment',
        index: 'attachment_messageId_idx_3cdded8d',
        columns: ['messageId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'attachment',
        index: 'attachment_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'chat',
        index: 'chat_userId_createdAt_id_idx_786b3fe4',
        columns: ['userId', 'createdAt', 'id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'chat',
        index: 'chat_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'creditLedger',
        index: 'creditLedger_agentRunId_idx_1f80425e',
        columns: ['agentRunId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'creditLedger',
        index: 'creditLedger_toolInvocationId_idx_e6be9b8d',
        columns: ['toolInvocationId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'creditLedger',
        index: 'creditLedger_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'generatedAsset',
        index: 'generatedAsset_chatId_idx_53965835',
        columns: ['chatId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'generatedAsset',
        index: 'generatedAsset_messageId_idx_3cdded8d',
        columns: ['messageId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'generatedAsset',
        index: 'generatedAsset_toolInvocationId_idx_e6be9b8d',
        columns: ['toolInvocationId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'generatedAsset',
        index: 'generatedAsset_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message',
        index: 'message_chatId_idx_53965835',
        columns: ['chatId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message',
        index: 'message_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'runSkill',
        index: 'runSkill_agentRunId_idx_1f80425e',
        columns: ['agentRunId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'toolInvocation',
        index: 'toolInvocation_agentRunId_idx_1f80425e',
        columns: ['agentRunId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'toolInvocation',
        index: 'toolInvocation_chatId_idx_53965835',
        columns: ['chatId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'toolInvocation',
        index: 'toolInvocation_messageId_idx_3cdded8d',
        columns: ['messageId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'waitpoint',
        index: 'waitpoint_agentRunId_idx_1f80425e',
        columns: ['agentRunId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'agentRun',
        foreignKey: {
          name: 'agentRun_chatId_fkey',
          columns: ['chatId'],
          references: { schema: 'public', table: 'chat', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'agentRun',
        foreignKey: {
          name: 'agentRun_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'agentRun',
        foreignKey: {
          name: 'agentRun_messageId_fkey',
          columns: ['messageId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'attachment',
        foreignKey: {
          name: 'attachment_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'attachment',
        foreignKey: {
          name: 'attachment_chatId_fkey',
          columns: ['chatId'],
          references: { schema: 'public', table: 'chat', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'attachment',
        foreignKey: {
          name: 'attachment_messageId_fkey',
          columns: ['messageId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'chat',
        foreignKey: {
          name: 'chat_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'creditLedger',
        foreignKey: {
          name: 'creditLedger_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'creditLedger',
        foreignKey: {
          name: 'creditLedger_agentRunId_fkey',
          columns: ['agentRunId'],
          references: { schema: 'public', table: 'agentRun', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'creditLedger',
        foreignKey: {
          name: 'creditLedger_toolInvocationId_fkey',
          columns: ['toolInvocationId'],
          references: { schema: 'public', table: 'toolInvocation', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'generatedAsset',
        foreignKey: {
          name: 'generatedAsset_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'generatedAsset',
        foreignKey: {
          name: 'generatedAsset_chatId_fkey',
          columns: ['chatId'],
          references: { schema: 'public', table: 'chat', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'generatedAsset',
        foreignKey: {
          name: 'generatedAsset_messageId_fkey',
          columns: ['messageId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'generatedAsset',
        foreignKey: {
          name: 'generatedAsset_toolInvocationId_fkey',
          columns: ['toolInvocationId'],
          references: { schema: 'public', table: 'toolInvocation', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message',
        foreignKey: {
          name: 'message_chatId_fkey',
          columns: ['chatId'],
          references: { schema: 'public', table: 'chat', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message',
        foreignKey: {
          name: 'message_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'runSkill',
        foreignKey: {
          name: 'runSkill_agentRunId_fkey',
          columns: ['agentRunId'],
          references: { schema: 'public', table: 'agentRun', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'toolInvocation',
        foreignKey: {
          name: 'toolInvocation_agentRunId_fkey',
          columns: ['agentRunId'],
          references: { schema: 'public', table: 'agentRun', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'toolInvocation',
        foreignKey: {
          name: 'toolInvocation_chatId_fkey',
          columns: ['chatId'],
          references: { schema: 'public', table: 'chat', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'toolInvocation',
        foreignKey: {
          name: 'toolInvocation_messageId_fkey',
          columns: ['messageId'],
          references: { schema: 'public', table: 'message', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'waitpoint',
        foreignKey: {
          name: 'waitpoint_agentRunId_fkey',
          columns: ['agentRunId'],
          references: { schema: 'public', table: 'agentRun', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
