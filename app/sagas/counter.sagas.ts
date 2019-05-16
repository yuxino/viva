import { delay, put, takeEvery } from 'redux-saga/effects';

// Our worker Saga: 将执行异步的 increment 任务
export function* incrementAsync() {
  yield delay(1000);
  yield put({ type: 'INCREMENT' });
}

export default [takeEvery('INCREMENT_ASYNC', incrementAsync)];
