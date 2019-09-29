import { takeLatest, put, select } from 'redux-saga/effects';
import WorkBenchActions from '../actions/Workbench';

// toggle workbench
function* workbench_toggle(action) {
  const { Workbench } = yield select();
  const { visible } = Workbench;
  yield put({
    type: visible
      ? WorkBenchActions.CLOSE_WORKBENCH
      : WorkBenchActions.OPEN_WORKBENCH,
    payload: action.payload
  });
}

export default [
  takeLatest(WorkBenchActions.TOGGLE_WORKBENCH, workbench_toggle)
];
