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
        private readonly IPilot _pilot;

        public SpaceshipRunner(ITargetDetector detector, ITargetPicker picker, IPilot pilot)
        {
            _detector = detector;
            _picker = picker;
            _pilot = pilot;
        }
        
        public void RunSpaceship()
        {
            var targets = _picker.FilterTargets(_detector.DetectTargets());
            var target = targets.OrderByDescending(t => t.Score).FirstOrDefault();

            _pilot.Fly(target);
        }
    }
}
