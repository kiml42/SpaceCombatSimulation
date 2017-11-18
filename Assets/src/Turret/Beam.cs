using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Turret
{
    public class Beam
    {
        public Transform Transform { get; internal set; }
        public Transform RayCaster { get; internal set; }

        /// <summary>
        /// In Seconds
        /// </summary>
        public float OnTime;

        /// <summary>
        /// In Seconds
        /// </summary>
        public float OffTime;
        public float BeamForce = 0;
        public Transform HitEffect;
        public string FriendlyTag = null;

        public float RemainingOnTime =0;
        public float RemainingOffTime =0;
        public float BeamDamage = 10;
        public float MaxDistance = 10000;
        public float InitialRadius = 1;
        public float Divergence = 0.0005f;
        
        private float _effectCooldown = 0;
        public float EffectRepeatTime = 0.1f;

        public Beam(Transform beam, float runTime, float offTime)
        {
            Transform = beam;
            OnTime = runTime;
            OffTime = offTime;
            RayCaster = Transform.parent ?? Transform;
            RemainingOnTime = OnTime;
        }

        public void TurnOn()
        {
            //Debug.Log(Transform + ": remainingOffTime: " + RemainingOffTime +
            //    ", remainingOnTime" + RemainingOnTime);
            var length = 0f;
            if (RemainingOffTime <= 0)
            {
                if(RemainingOnTime > 0)
                {
                    //Debug.Log("shooting");
                    //is running
                    length = FireNow();
                    RemainingOnTime -= Time.deltaTime;
                } else
                {
                    //Debug.Log("Needs Reloading");
                    //should start reloading
                    RemainingOffTime = OffTime;
                }
            } else
            {
                //is reloading
                //Debug.Log("reloading");
                RemainingOffTime -= Time.deltaTime;
                RemainingOnTime = OnTime;
            }
            Transform.localScale = new Vector3(1, 1, length);
        }

        private float FireNow()
        {
            RaycastHit hit;
            var ray = new Ray(RayCaster.position, RayCaster.forward);
            if (Physics.Raycast(ray, out hit, MaxDistance, -1, QueryTriggerInteraction.Ignore))
            {
                //is a hit
                if (!string.IsNullOrEmpty(FriendlyTag) && hit.transform.tag == FriendlyTag)
                {
                    //turn off if not aimed at a friend
                    TurnOff();
                    return 0;
                }
                if (hit.rigidbody != null)
                {
                    hit.rigidbody.AddExplosionForce(ReduceForDistance(BeamForce, hit.distance), hit.point, 10);
                }
                if (HitEffect != null)
                {
                    if(_effectCooldown <= 0)
                    {
                        //var orientation = hit.normal; //use this to properly orient the effect
                        GameObject.Instantiate(HitEffect, hit.point, RayCaster.rotation);
                        _effectCooldown = EffectRepeatTime;
                    } else
                    {
                        _effectCooldown -= Time.deltaTime;
                    }
                }
                hit.transform.SendMessage("ApplyDamage", ReduceForDistance(BeamDamage, hit.distance), SendMessageOptions.DontRequireReceiver);
                return hit.distance;
            }
            //is a miss
            return MaxDistance;
        }

        private float ReduceForDistance(float baseDamage, float distance)
        {
            var radius = InitialRadius + (Divergence * distance);
            var reduced = baseDamage * Time.deltaTime / (radius * radius);
            return reduced;
        }

        public void TurnOff()
        {
            RemainingOffTime -= Time.deltaTime;
            if(Transform.IsValid())
                Transform.localScale = Vector3.zero;
        }

        /// <summary>
        /// Forces a reload with the given time required to reload
        /// </summary>
        /// <param name="timeToReload">use null (default) for the normal reload time.</param>
        public void ForceReload(float? timeToReload = null)
        {
            timeToReload = timeToReload ?? OffTime;
            RemainingOffTime = timeToReload.Value;
            RemainingOnTime = OnTime;
        }
    }
}
