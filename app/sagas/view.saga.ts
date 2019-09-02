import { takeEvery, put, select } from 'redux-saga/effects';
import TitleBarActions from '../actions/Titlebar';
import TabsActions from '../actions/Tabs';
import ViewActions from '../actions/View';

// worker Saga: will be fired on USER_FETCH_REQUESTED actions
function* tabs_update(action) {
  const { name, content } = action.payload.fileInfo;
  const state = yield select();
  const { edtiorSyncFn } = state.view;

  // update editor and preview
  edtiorSyncFn(content);

  // update editor title
  yield put({ type: TitleBarActions.UPDATE_TITLE, payload: { title: name } });

  // add new tab to tabs
  yield put({ type: TabsActions.ADD_NEW_TAB, payload: { name } });
}

// CLOSE_TAB
function* close_tab(action) {
  const { tab } = action.payload;
  const state = yield select();
  const { edtiorSyncFn } = state.view;

  // update editor and preview
  edtiorSyncFn('');

  // close target tab
  yield put({ type: TabsActions.CLOSE_TAB, payload: { tab } });
}

export default [
  takeEvery(ViewActions.TABS_UPDATE, tabs_update),
  takeEvery(ViewActions.CLEAR_EDITOR_CONTENT, close_tab)
];
