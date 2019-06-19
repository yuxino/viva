import { takeEvery, put, select } from 'redux-saga/effects';
import TitleBarActions from '../actions/titlebar';
import ViewActions from '../actions/view';
import { stat } from 'fs';

// worker Saga: will be fired on USER_FETCH_REQUESTED actions
function* tabs_update(action) {
  const { name, content } = action.payload.fileInfo;
  const state = yield select();
  const { edtiorSyncFn } = state.view;

  // update editor and preview
  edtiorSyncFn(content);

  // update editor title
  yield put({
    type: TitleBarActions.UPDATE_TITLE,
    payload: { title: name }
  });
}

export default [takeEvery(ViewActions.TABS_UPDATE, tabs_update)];
