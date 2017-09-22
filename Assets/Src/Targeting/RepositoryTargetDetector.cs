using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public class RepositoryTargetDetector : ITargetDetector
    {
        public IEnumerable<string> EnemyTags = new List<string> { "Enemy" };
        public float ProjectileSpeed = 0;

        public RepositoryTargetDetector()
        {

        }

        public IEnumerable<PotentialTarget> DetectTargets()
        {
            return TargetRepository.ListTargetsForTags(EnemyTags);
        }
    }
}
