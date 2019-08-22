import Tabs from '../../app/model/Tabs';
import Tab from '../../app/model/Tab';

const mapData = (tabs: Tabs) => tabs.getArray().map(tab => tab.data);

describe('model/tabs', () => {
  describe('addTab', () => {
    it('head node is equal tail node', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      tabs.addTab(tab1);

      expect(tabs.size).toEqual(1);
      expect(tabs.head).toEqual(tabs.tail);
    });

    it('order should be 1,2,3', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      const tab2 = new Tab({ data: 2 });
      const tab3 = new Tab({ data: 3 });

      tabs.addTab(tab1);
      tabs.addTab(tab2);
      tabs.addTab(tab3);

      expect(tabs.head).toBe(tab1);
      expect(tabs.size).toBe(3);
      expect(mapData(tabs)).toEqual([1, 2, 3]);
      expect(tabs.tail).toBe(tab3);
    });

    it('order should be 3,2,1', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      const tab2 = new Tab({ data: 2 });
      const tab3 = new Tab({ data: 3 });

      tabs.addTab(tab3);
      tabs.addTab(tab2);
      tabs.addTab(tab1);

      expect(tabs.head).toBe(tab3);
      expect(tabs.size).toBe(3);
      expect(mapData(tabs)).toEqual([3, 2, 1]);
      expect(tabs.tail).toBe(tab1);
    });
  });

  describe('removeTab', () => {
    it('remove only one tab', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });

      tabs.addTab(tab1);

      tabs.removeTab(tab1);

      expect(tabs.head).toBe(null);
      expect(mapData(tabs)).toEqual([]);
      expect(tabs.tail).toBe(null);
      expect(tabs.size).toBe(0);
    });

    it('remove second tab order should be 1,3', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      const tab2 = new Tab({ data: 2 });
      const tab3 = new Tab({ data: 3 });

      tabs.addTab(tab1);
      tabs.addTab(tab2);
      tabs.addTab(tab3);

      tabs.removeTab(tab2);

      expect(tabs.head).toBe(tab1);
      expect(mapData(tabs)).toEqual([1, 3]);
      expect(tabs.tail).toBe(tab3);
      expect(tabs.size).toBe(2);
    });

    it('remove first tab order should be 2,3, tabs.head.prev should be null', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      const tab2 = new Tab({ data: 2 });
      const tab3 = new Tab({ data: 3 });

      tabs.addTab(tab1);
      tabs.addTab(tab2);
      tabs.addTab(tab3);

      tabs.removeTab(tab1);

      expect(tabs.head).toBe(tab2);
      expect(tabs.head.prev).toBe(null);
      expect(mapData(tabs)).toEqual([2, 3]);
      expect(tabs.tail).toBe(tab3);
      expect(tabs.tail.next).toBe(null);
      expect(tabs.size).toBe(2);
    });

    it('remove last tab order should be 1,2, tail.next should be null', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      const tab2 = new Tab({ data: 2 });
      const tab3 = new Tab({ data: 3 });

      tabs.addTab(tab1);
      tabs.addTab(tab2);
      tabs.addTab(tab3);

      tabs.removeTab(tab3);

      expect(tabs.head).toBe(tab1);
      expect(mapData(tabs)).toEqual([1, 2]);
      expect(tabs.tail).toBe(tab2);
      expect(tabs.tail.next).toBe(null);
      expect(tab3.next).toBe(null);
      expect(tabs.size).toBe(2);
    });
  });

  describe('removeSavedTab', () => {
    it('should remove all saved tabs', () => {
      const tabs = new Tabs();

      const tab1 = new Tab({ data: 1 });
      tabs.addTab(tab1);

      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);

      const tab3 = new Tab({ data: 3 });
      tab3.saved = false;
      tabs.addTab(tab3);

      tabs.removeSavedTab();

      expect(tabs.size).toBe(1);
      expect(tabs.head).toEqual(tab3);
      expect(mapData(tabs)).toEqual([3]);
    });
  });

  describe('removeAll', () => {
    it('should remove all tabs', () => {
      const tabs = new Tabs();

      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);

      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);

      tabs.removeAll();
      expect(tabs.head).toBeNull();
      expect(tabs.size).toBe(0);
      expect(tabs.size).toBe(0);
      expect(tabs.isEmpty()).toBe(true);
    });
  });

  describe('removeLeft', () => {
    it('removeLeft when only one tab', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      tabs.addTab(tab1);
      tabs.removeLeft(tab1);

      expect(tabs.size).toBe(1);
      expect(tabs.head).toBe(tab1);
      expect(tabs.tail).toBe(tab1);
      expect(tabs.head.prev).toBe(null);
      expect(tabs.head).toEqual(tabs.tail);
      expect(mapData(tabs)).toEqual([1]);
    });

    it('should remove tabs on the left side of first tab', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      tabs.addTab(tab1);

      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);

      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);

      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);

      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);

      tabs.removeLeft(tab1);

      expect(tabs.size).toBe(5);
      expect(tabs.head).toBe(tab1);
      expect(tabs.tail).toBe(tab5);
      expect(tabs.head.prev).toBe(null);
      expect(mapData(tabs)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should remove tabs on the left side of tab', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      tabs.addTab(tab1);

      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);

      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);

      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);

      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);

      tabs.removeLeft(tab3);

      expect(tabs.size).toBe(3);
      expect(tabs.head).toBe(tab3);
      expect(tabs.tail).toBe(tab5);
      expect(tabs.head.prev).toBe(null);
      expect(mapData(tabs)).toEqual([3, 4, 5]);
    });
  });

  describe('removeRight', () => {
    it('removeRight when only one tab', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      tabs.addTab(tab1);
      tabs.removeRight(tab1);

      expect(tabs.size).toBe(1);
      expect(tabs.head).toBe(tab1);
      expect(tabs.tail).toBe(tab1);
      expect(tabs.tail.prev).toBe(null);
      expect(tabs.tail).toEqual(tabs.head);
      expect(mapData(tabs)).toEqual([1]);
    });

    it('should remove tabs on the rgiht side of last tab', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      tabs.addTab(tab1);

      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);

      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);

      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);

      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);

      tabs.removeRight(tab5);

      expect(tabs.size).toBe(5);
      expect(tabs.head).toBe(tab1);
      expect(tabs.tail).toBe(tab5);
      expect(tabs.tail.next).toBe(null);
      expect(mapData(tabs)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should remove tabs on the right side of tab', () => {
      const tabs = new Tabs();
      const tab1 = new Tab({ data: 1 });
      tabs.addTab(tab1);

      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);

      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);

      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);

      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);

      tabs.removeRight(tab3);

      expect(tabs.size).toBe(3);
      expect(tabs.head).toBe(tab1);
      expect(tabs.tail).toBe(tab3);
      expect(tabs.tail.next).toBe(null);
      expect(mapData(tabs)).toEqual([1, 2, 3]);
    });
  });

  describe('swapTab', () => {
    // swapHeadTail
    it('swap head to tail, order should be 2,1', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);

      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      tabs.swapTab(tab, tab2);

      expect(tabs.head.prev).toEqual(null);
      expect(tabs.tail.next).toEqual(null);

      expect(mapData(tabs)).toEqual([2, 1]);
    });

    // swapHeadTail;
    it('swap tail to head, order should be 2,1', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);
      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      tabs.swapTab(tab2, tab);
      expect(tabs.head.prev).toEqual(null);
      expect(tabs.tail.next).toEqual(null);
      expect(mapData(tabs)).toEqual([2, 1]);
    });

    // swapHeadTail
    it('swap head to tail, order should be 3,2,1', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);
      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);
      tabs.swapTab(tab, tab3);
      expect(mapData(tabs)).toEqual([3, 2, 1]);
    });

    // swapHeadTail
    it('swap tail to head, order should be 3,2,1', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);
      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);
      tabs.swapTab(tab3, tab);
      expect(mapData(tabs)).toEqual([3, 2, 1]);
    });

    // swapWithHead
    it('swap 1 to 2, order should be 2,1,3,4,5', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);
      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);
      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);
      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);
      tabs.swapTab(tab2, tab);
      expect(mapData(tabs)).toEqual([2, 1, 3, 4, 5]);
      expect(tabs.head.prev).toBeNull();
    });

    it('swap 1 to 3, order should be 3,2,1,4,5', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);
      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);
      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);
      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);
      tabs.swapTab(tab3, tab);
      expect(mapData(tabs)).toEqual([3, 2, 1, 4, 5]);
      expect(tabs.head.prev).toBeNull();
    });

    // swapWithTail
    it('swap 4 to 5, order should be 1,2,3,5,4', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);
      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);
      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);
      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);
      tabs.swapTab(tab5, tab4);
      expect(mapData(tabs)).toEqual([1, 2, 3, 5, 4]);
      expect(tabs.tail.next).toBeNull();
    });

    // swapWithTail
    it('swap 3 to 5, order should be 1,2,5,4,3', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);
      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);
      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);
      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);
      tabs.swapTab(tab3, tab5);
      expect(mapData(tabs)).toEqual([1, 2, 5, 4, 3]);
    });

    // swapBetween near
    it('swap 2 to 3, order should be 1,2,4,3,5 ', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);
      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);
      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);
      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);
      tabs.swapTab(tab2, tab3);
      expect(mapData(tabs)).toEqual([1, 3, 2, 4, 5]);
    });

    // swapBetween near
    it('swap 3 to 2, order should be 1,2,4,3,5 ', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);
      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);
      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);
      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);
      tabs.swapTab(tab3, tab2);
      expect(mapData(tabs)).toEqual([1, 3, 2, 4, 5]);
    });

    // swapBetween
    it('swap 2 to 4, order should be 1,4,3,2,5 ', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);
      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);
      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);
      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);
      tabs.swapTab(tab2, tab4);
      expect(mapData(tabs)).toEqual([1, 4, 3, 2, 5]);
    });

    // swapBetween
    it('swap 4 to 2, order should be 1,4,3,2,5 ', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);
      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);
      const tab3 = new Tab({ data: 3 });
      tabs.addTab(tab3);
      const tab4 = new Tab({ data: 4 });
      tabs.addTab(tab4);
      const tab5 = new Tab({ data: 5 });
      tabs.addTab(tab5);
      tabs.swapTab(tab4, tab2);
      expect(mapData(tabs)).toEqual([1, 4, 3, 2, 5]);
    });
  });

  describe('iterable', () => {
    it('tabs is iterable', () => {
      const tabs = new Tabs();
      expect(typeof tabs[Symbol.iterator]).toBe('function');
    });

    it('correct behavior', () => {
      const tabs = new Tabs();
      const tab = new Tab({ data: 1 });
      tabs.addTab(tab);

      const tab2 = new Tab({ data: 2 });
      tabs.addTab(tab2);

      let iterator = tabs[Symbol.iterator]();
      let result = iterator.next();
      expect(result.value).toEqual(tab);

      let result2 = iterator.next();
      expect(result2.value).toEqual(tab2);

      let result3 = iterator.next();
      expect(result3.done).toBe(true);
    });
  });
});
