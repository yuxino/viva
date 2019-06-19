import { all } from 'redux-saga/effects';
import viewSaga from './view.saga';

function* watchAll() {
  yield all([...viewSaga]);
}

export default watchAll;
