using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public class ChildTagTargetDetector : ITargetDetector
    {
        public string Tag = "SpaceShip";
        public float ProjectileSpeed = 0;

        public ChildTagTargetDetector()
        {

        }

        public IEnumerable<PotentialTarget> DetectTargets()
        {
            var gameObjects = GameObject.FindGameObjectsWithTag(Tag)
                .Select(o => o.transform.parent)
                .Where(o => o!= null && o.GetComponent("Rigidbody"));

            return gameObjects.Select(g => new PotentialTarget(g.transform));
        }
    }
}
