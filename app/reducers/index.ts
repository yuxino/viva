import { combineReducers } from 'redux';
import explore from './explore';
import tabs from './tabs';
import titlebar from './titlebar';
import views from './views';

export default function createRootReducer() {
  return combineReducers({
    explore,
    tabs,
    titlebar,
    views
  });
}
