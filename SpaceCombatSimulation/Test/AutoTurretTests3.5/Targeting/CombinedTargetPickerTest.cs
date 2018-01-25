using Assets.Src.Interfaces;
using Assets.Src.Targeting;
//using Moq;
using System.Collections.Generic;
using Xunit;

namespace AutoTurretTests.Targeting
{
    public class CombinedTargetPickerTest
    {
        //Mock<ITargetPicker> _p1;
        //Mock<ITargetPicker> _p2;

        CombinedTargetPicker _picker;

        public CombinedTargetPickerTest()
        {
            //var pickers = new List<ITargetPicker> { _p1.Object, _p2.Object };
            //_picker = new CombinedTargetPicker(pickers);
        }

        [Fact]
        public void FilterTargetsCallsAllPickers()
        {

        }
    }
}
