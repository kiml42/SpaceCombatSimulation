using Assets.src.interfaces;
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
        private readonly IKnowsCurrentTarget _knower;

        public SpaceshipRunner(ITargetDetector detector, ITargetPicker picker, IPilot pilot, IKnowsCurrentTarget knower)
        {
            _detector = detector;
            _picker = picker;
            _pilot = pilot;
            _knower = knower;
        }
        
        public void RunSpaceship()
        {
            var targets = _picker.FilterTargets(_detector.DetectTargets());
            var target = targets.OrderByDescending(t => t.Score).FirstOrDefault();
            if(_knower != null)
            {
                _knower.CurrentTarget = target;
            }

            _pilot.Fly(target);
        }
    }
}
