import { all } from 'redux-saga/effects';
import ViewSaga from './View.saga';

function* watchAll() {
  yield all([...ViewSaga]);
}

export default watchAll;
