/**
 * Which backend the shared log panels talk to. CloudWatch Logs is the
 * default; the Kubernetes logs view provides its own (same paths under
 * /api/kube-logs, without the CloudWatch-only volume metric and Logs Insights).
 */
import { inject, provide } from 'vue'

export const AWS_LOG_API = Object.freeze({ provider: 'aws', base: '/api/cloud/aws/cloudwatch', volume: true, insights: true })
export const KUBE_LOG_API = Object.freeze({ provider: 'kubernetes', base: '/api/kube-logs', volume: false, insights: false })

const KEY = Symbol('logApi')

export function provideLogApi(api) {
  provide(KEY, api)
}

export function useLogApi() {
  return inject(KEY, AWS_LOG_API)
}
