using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;
using System.Collections.Generic;
using System.Linq;

namespace AutoTurretTests.Targeting
{
    [TestClass]
    public class CombinedTargetPickerTest
    {
        Mock<ITargetPicker> _p1;
        Mock<ITargetPicker> _p2;

        private readonly IEnumerable<PotentialTarget> testTargets = new List<PotentialTarget> { new PotentialTarget { Score = 1 } };
        private readonly IEnumerable<PotentialTarget> ReturnedTargetsP1 = new List<PotentialTarget> { new PotentialTarget { Score = 2 } };
        private readonly IEnumerable<PotentialTarget> ReturnedTargetsP2 = new List<PotentialTarget> { new PotentialTarget { Score = 3 } };

        CombinedTargetPicker _picker;

        public CombinedTargetPickerTest()
        {
            _p1 = new Mock<ITargetPicker>();
            _p2 = new Mock<ITargetPicker>();

            _p1.Setup(p => p.FilterTargets(It.IsAny<IEnumerable<PotentialTarget>>())).Returns(ReturnedTargetsP1);
            _p2.Setup(p => p.FilterTargets(It.IsAny<IEnumerable<PotentialTarget>>())).Returns(ReturnedTargetsP2);
            var pickers = new List<ITargetPicker> { _p1.Object, _p2.Object };
            _picker = new CombinedTargetPicker(pickers);
        }

        [TestMethod]
        public void FilterTargetsCallsAllPickers()
        {
            var filteredTargets = _picker.FilterTargets(testTargets);
            
            Assert.AreEqual(ReturnedTargetsP2.Single().Score, filteredTargets.Single().Score);

            _p1.Verify(p => p.FilterTargets(It.IsAny<IEnumerable<PotentialTarget>>()), Times.Once);
            _p1.Verify(p => p.FilterTargets(testTargets), Times.Once);

            _p2.Verify(p => p.FilterTargets(It.IsAny<IEnumerable<PotentialTarget>>()), Times.Once);
            _p2.Verify(p => p.FilterTargets(ReturnedTargetsP1), Times.Once);
        }
    }
}
