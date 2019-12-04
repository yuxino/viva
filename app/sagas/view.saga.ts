import { takeEvery, put, select } from 'redux-saga/effects';
import TitleBarActions from '../actions/Titlebar';
import TabsActions from '../actions/Tabs';
import ViewActions from '../actions/View';
import WorkbenchActions from '../actions/Workbench';

// worker Saga: will be fired on USER_FETCH_REQUESTED actions
function* tabs_update(action) {
  const { name, content } = action.payload.fileInfo;
  const { View } = yield select();
  const { edtiorSyncFn } = View;

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
  const { View } = yield select();
  const { edtiorSyncFn } = View;

  // update editor and preview
  edtiorSyncFn('');

  // close target tab
  yield put({ type: TabsActions.CLOSE_TAB, payload: { tab } });
}

// OPEN_DIR
function* open_dir(action) {
  // drop a directory in view

  // update editor title
  yield put({
    type: TitleBarActions.UPDATE_TITLE,
    payload: { title: action.payload.fileInfo.path }
  });

  // open explore
  yield put({
    type: WorkbenchActions.OPEN_WORKBENCH,
    payload: { title: 'Explorer' }
  });

  // tell expore which dir been open
}

export default [
  takeEvery(ViewActions.TABS_UPDATE, tabs_update),
  takeEvery(ViewActions.CLEAR_EDITOR_CONTENT, close_tab),
  takeEvery(ViewActions.OPEN_DIR, open_dir)
];
