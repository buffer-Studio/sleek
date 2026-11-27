import {z} from 'zod';

export const platformIdSchema = z.enum(['discord', 'fluxer']);

export const childToParentMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('identifyRequest'),
    platform: platformIdSchema,
    shardId: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('ready'),
    platform: platformIdSchema,
    shardId: z.number().int().min(0),
    guildCount: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('fatalClose'),
    platform: platformIdSchema,
    shardId: z.number().int().min(0),
    code: z.number().int(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('stats'),
    clusterId: z.string(),
    guildCount: z.number().int().min(0),
    rssBytes: z.number().int().min(0),
  }),
]);

export const parentToChildMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('identifyGrant'),
    platform: platformIdSchema,
    shardId: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('shutdown'),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('requestStats'),
  }),
]);

export type ChildToParentMessage = z.infer<typeof childToParentMessageSchema>;
export type ParentToChildMessage = z.infer<typeof parentToChildMessageSchema>;
