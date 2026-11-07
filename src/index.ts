import wip from './wip.ts';

export { wip };
export default wip;

// Lets `require('@cinderblock/node-git-wip')` keep returning the function itself, as it did before v1.
export { wip as 'module.exports' };

export type {
  AddFlags,
  DebugFunction,
  HistoryStrategy,
  SignatureInput,
  WipFailure,
  WipOptions,
  WipResult,
} from './types.ts';
