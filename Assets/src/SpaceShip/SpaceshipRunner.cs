using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.SpaceShip
{
    public class SpaceshipRunner
    {
        private readonly ITargetDetector _detector;
        private readonly ITargetPicker _picker;
        private readonly IRocketEngineControl _engineControl;

        public SpaceshipRunner(ITargetDetector detector, ITargetPicker picker, IRocketEngineControl engineControl)
        {
            _detector = detector;
            _picker = picker;
            _engineControl = engineControl;
            LocationTollerance = 20;
            VelociyTollerance = 0.05f;
        }

        public float LocationTollerance { get; set; }
        public float VelociyTollerance { get; set; }

        public void RunSpaceship()
        {
            var targets = _picker.FilterTargets(_detector.DetectTargets());
            var target = targets.FirstOrDefault();

            _engineControl.FlyToTarget(target, 0, LocationTollerance, VelociyTollerance);
        }
    }
}
