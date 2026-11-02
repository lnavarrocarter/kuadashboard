// Value of the X-KUA-Task header (#325): the task that asked for a request and the run that
// groups the requests of one invocation, so the backend task journal can attribute their cost.
// Keys name the intent ('app.load', 'review.confirm-dependencies'), never the URL.
let sequence = 0

export function taskRun(key) {
  sequence = (sequence + 1) % 1679616
  return `${key};${Date.now().toString(36)}-${sequence.toString(36)}`
}
