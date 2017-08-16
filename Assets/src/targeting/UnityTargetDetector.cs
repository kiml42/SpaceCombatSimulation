using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Targeting
{
    public class UnityTargetDetector : ITargetDetector
    {
        public string EnemyTag = "Enemy";
        public float ProjectileSpeed = 0;

        public UnityTargetDetector()
        {

        }

        public IEnumerable<PotentialTarget> DetectTargets()
        {
            var gameObjects = GameObject.FindGameObjectsWithTag(EnemyTag)
                .Where(o => o.GetComponent("Rigidbody"));
            //Debug.Log("enemy tag: " + EnemyTag + ", count: " + gameObjects.Count());
            //foreach (var obj in gameObjects)
            //{
            //    Debug.Log(obj.name + ", parent:" + obj.transform.parent + ", loc:" +obj.transform.position);
            //    if (obj.transform.parent != null)
            //    {
            //        Debug.Log(obj.transform.parent.transform.parent);
            //    }
            //}

            return gameObjects.Select(g => new PotentialTarget(g.transform, ProjectileSpeed));
        }
    }
}
