using System;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Assets.Src.Targeting;
using Assets.Src.Interfaces;
using Moq;
using System.Collections.Generic;
using System.Linq;

namespace UnitTestProject1.Targeting
{
    [TestClass]
    public class TurretRunnerTests
    {
        private TurretRunner _runner;

        private readonly PotentialTarget _bestTarget = new PotentialTarget { Score = 3 };
        private readonly IEnumerable<PotentialTarget> testTargets = new List<PotentialTarget> { new PotentialTarget { Score = 1 } };
        private readonly IEnumerable<PotentialTarget> ReturnedTargetsP1;

        Mock<ITargetPicker> _p1;
        Mock<ITurretTurner> _turner;
        Mock<IFireControl> _fireControl;
        Mock<ITargetDetector> _detector;


        public TurretRunnerTests()
        {

            ReturnedTargetsP1 = new List<PotentialTarget> { new PotentialTarget { Score = 2 }, _bestTarget };

            _detector = new Mock<ITargetDetector>();
            _p1 = new Mock<ITargetPicker>();
            _turner = new Mock<ITurretTurner>();
            _fireControl = new Mock<IFireControl>();

            _detector.Setup(d => d.DetectTargets()).Returns(testTargets);
            _p1.Setup(p => p.FilterTargets(It.IsAny<IEnumerable<PotentialTarget>>())).Returns(ReturnedTargetsP1);

            _runner = new TurretRunner(_detector.Object, _p1.Object, _turner.Object, _fireControl.Object);

        }

        [TestMethod]
        public void RunTurretWithValidTarget()
        {
            _runner.RunTurret();

            _detector.Verify(d => d.DetectTargets(), Times.Once);

            _p1.Verify(p => p.FilterTargets(It.IsAny<IEnumerable<PotentialTarget>>()), Times.Once);
            _p1.Verify(p => p.FilterTargets(testTargets), Times.Once);

            _turner.Verify(p => p.TurnToTarget(It.IsAny<PotentialTarget>()), Times.Once);
            _turner.Verify(p => p.TurnToTarget(_bestTarget), Times.Once);

            _fireControl.Verify(f => f.ShootIfAimed(It.IsAny<PotentialTarget>()), Times.Once);
            _fireControl.Verify(f => f.ShootIfAimed(_bestTarget), Times.Once);
        }

        [TestMethod]
        public void RunTurretWithNoValidTarget()
        {
            //No valid targets -> empty list returned
            _p1.Setup(p => p.FilterTargets(It.IsAny<IEnumerable<PotentialTarget>>())).Returns(new List<PotentialTarget>());

            _runner.RunTurret();

            _p1.Verify(p => p.FilterTargets(It.IsAny<IEnumerable<PotentialTarget>>()), Times.Once);
            _p1.Verify(p => p.FilterTargets(testTargets), Times.Once);

            _turner.Verify(p => p.TurnToTarget(It.IsAny<PotentialTarget>()), Times.Never);

            _turner.Verify(p => p.ReturnToRest(), Times.Once);

            _fireControl.Verify(f => f.ShootIfAimed(It.IsAny<PotentialTarget>()), Times.Never);
        }
    }
}
