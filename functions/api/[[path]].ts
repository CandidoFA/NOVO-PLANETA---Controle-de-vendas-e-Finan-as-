import { handleApiRequest } from '../../worker/index';
import { WorkerEnv } from '../../worker/types';

export async function onRequest(context: { request: Request; env: WorkerEnv }): Promise<Response> {
  return handleApiRequest(context.request, context.env);
}
