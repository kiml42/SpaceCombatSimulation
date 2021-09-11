using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Targeting
{
    /// <summary>
    /// Detects all targets that have a child object with any of the given tags.
    /// </summary>
    public class ChildTagTargetDetector : ITargetDetector
    {
        public List<string> Tags = new List<string> { "SpaceShip" };
        public float ProjectileSpeed = 0;

        public ChildTagTargetDetector()
        {

        }

        public IEnumerable<PotentialTarget> DetectTargets(bool includeNavigationTarets = false, bool includeAtackTargets = true)
        {
            var targets = new List<PotentialTarget>();
            foreach (var tag in Tags)
            {
                var gameObjects = GameObject.FindGameObjectsWithTag(tag)
                    .Select(o => o.transform.parent)
                    .Where(o => o != null && o.GetComponent<Rigidbody>());
                //Debug.Log(gameObjects.Count() + " for tag " + tag);
                targets.AddRange(gameObjects.Select(g => new PotentialTarget(g.transform)));
            }

            //Debug.Log(targets.Count() + " total " );

            return targets;
        }
    }
}
