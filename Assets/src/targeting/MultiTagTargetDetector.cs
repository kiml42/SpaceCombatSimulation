using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public class MultiTagTargetDetector : ITargetDetector
    {
        public IEnumerable<string> EnemyTags = new List<string> { "Enemy" };
        public float ProjectileSpeed = 0;

        public MultiTagTargetDetector()
        {

        }

        public IEnumerable<PotentialTarget> DetectTargets()
        {
            var targets = new List<PotentialTarget>();
            foreach (var tag in EnemyTags)
            {
                var gameObjects = GameObject.FindGameObjectsWithTag(tag)
                    .Where(o => o.GetComponent("Rigidbody"));
                //Debug.Log(gameObjects.Count() + " for tag " + tag);
                targets.AddRange(gameObjects.Select(g => new PotentialTarget(g.transform)));
            }

            //Debug.Log(targets.Count() + " total " );

            return targets;
        }
    }
}
