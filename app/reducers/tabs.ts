import Tabs from '../model/Tabs';
import Tab from '../model/Tab';
import TabsAction from '../actions/tabs';

const tabs = new Tabs();

tabs.addTab(new Tab({ data: { name: 'AAAA.md' } }));
tabs.addTab(new Tab({ data: { name: 'BBBB.md' } }));
tabs.addTab(new Tab({ data: { name: 'CCCC.md' } }));
tabs.addTab(new Tab({ data: { name: 'DDDD.md' } }));
tabs.addTab(new Tab({ data: { name: 'EEEE.md' } }));

export const initState = function() {
  return {
    tabs: tabs
  };
};

export default (state = initState(), action) => {
  switch (action.type) {
    case TabsAction.UPDATE_TAB_ORDER: {
      const { dragProps, dropProps } = action.payload;
      tabs.swapTab(dragProps.item, dropProps.item);
    }
  }
  return {
    ...state,
    tabs: tabs.getArray(),
    isEmpty: tabs.isEmpty()
  };
};
