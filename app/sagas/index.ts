import { all } from 'redux-saga/effects';
import counterSags from './counter.sagas';

function* watchAll() {
  yield all([...counterSags]);
}

export default watchAll;
