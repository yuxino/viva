import Tabs from '../../app/model/tabs';
import Tab from '../../app/model/tab';

describe('model/tabs', () => {
  describe('addTab', () => {
    it('head node is equal tail node', () => {
      const tabs = new Tabs();
      const tab = new Tab();
      // tabs.addTab()
    });
  });

  // describe('removeTab', () => {
  //   it('should remove a tab by instance', () => {
  //     const tabs = new Tabs();

  //     const tab = new Tab();
  //     tabs.addTab(tab);

  //     tabs.removeTab(tab);
  //     expect(tabs.size).toBe(0);
  //   });
  // });

  // describe('removeSavedTab', () => {
  //   it('should remove all saved tabs', () => {
  //     const tabs = new Tabs();

  //     const tab = new Tab();
  //     tabs.addTab(tab);

  //     const tab2 = new Tab();
  //     tabs.addTab(tab2);

  //     const tab3 = new Tab();
  //     tab3.saved = false;
  //     tabs.addTab(tab3);

  //     tabs.removeSavedTab();
  //     expect(tabs.size).toBe(1);

  //     for (let item of tabs.tabs) {
  //       expect(item.saved).toBe(false);
  //     }
  //   });
  // });

  // describe('removeAll', () => {
  //   it('should remove all tabs', () => {
  //     const tabs = new Tabs();

  //     const tab = new Tab();
  //     tabs.addTab(tab);

  //     const tab2 = new Tab();
  //     tabs.addTab(tab2);

  //     tabs.removeAll();
  //     expect(tabs.size).toBe(0);
  //     expect(tabs.isEmpty()).toBe(true);
  //   });
  // });

  // describe('findTabIdx', () => {
  //   const tabs = new Tabs();
  //   const tab1 = new Tab();
  //   const tab2 = new Tab();
  //   tabs.addTab(tab1);
  //   tabs.addTab(tab2);

  //   it('should be 0', () => {
  //     expect(tabs.findTabIdx(tab1)).toBe(0);
  //   });

  //   it('should be 1', () => {
  //     expect(tabs.findTabIdx(tab2)).toBe(1);
  //   });

  //   it('should be -1', () => {
  //     expect(tabs.findTabIdx(null)).toBe(-1);
  //     expect(tabs.findTabIdx(undefined)).toBe(-1);
  //     expect(tabs.findTabIdx(new Tab())).toBe(-1);
  //   });
  // });

  // describe('removeLeft', () => {
  //   it('should remove tabs on the left side of tab', () => {
  //     const tabs = new Tabs();
  //     const tab1 = new Tab();
  //     tabs.addTab(tab1);

  //     const tab2 = new Tab();
  //     tabs.addTab(tab2);

  //     const tab3 = new Tab();
  //     tabs.addTab(tab3);

  //     const tab4 = new Tab();
  //     tabs.addTab(tab4);

  //     const tab5 = new Tab();
  //     tabs.addTab(tab5);

  //     tabs.removeLeft(tab3);

  //     expect(tabs.size).toBe(3);
  //     expect(tabs.has(tab1)).toBe(false);
  //     expect(tabs.has(tab2)).toBe(false);
  //     expect(tabs.has(tab3)).toBe(true);
  //     expect(tabs.has(tab4)).toBe(true);
  //     expect(tabs.has(tab5)).toBe(true);
  //   });
  // });

  // describe('removeRight', () => {
  //   it('should remove tabs on the right side of tab', () => {
  //     const tabs = new Tabs();
  //     const tab1 = new Tab();
  //     tabs.addTab(tab1);

  //     const tab2 = new Tab();
  //     tabs.addTab(tab2);

  //     const tab3 = new Tab();
  //     tabs.addTab(tab3);

  //     const tab4 = new Tab();
  //     tabs.addTab(tab4);

  //     const tab5 = new Tab();
  //     tabs.addTab(tab5);

  //     tabs.removeRight(tab3);

  //     expect(tabs.size).toBe(3);
  //     expect(tabs.has(tab1)).toBe(true);
  //     expect(tabs.has(tab2)).toBe(true);
  //     expect(tabs.has(tab3)).toBe(true);
  //     expect(tabs.has(tab4)).toBe(false);
  //     expect(tabs.has(tab5)).toBe(false);
  //   });
  // });
});
