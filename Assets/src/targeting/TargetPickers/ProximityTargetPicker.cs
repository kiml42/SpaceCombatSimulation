using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting.TargetPickers
{
    class ProximityTargetPicker : ITargetPicker
    {
        private Rigidbody _sourceObject;

        public ProximityTargetPicker(Rigidbody sourceObject)
        {
            _sourceObject = sourceObject;
        }

        public IEnumerable<PotentialTarget> FilterTargets(IEnumerable<PotentialTarget> potentialTargets)
        {
            return potentialTargets.Select(t => AddScoreForDifference(t));
        }

        private PotentialTarget AddScoreForDifference(PotentialTarget target)
        {
            var dist = target.DistanceToTurret(_sourceObject);
            target.Score = target.Score - dist;
            return target;
        }
    }
}
