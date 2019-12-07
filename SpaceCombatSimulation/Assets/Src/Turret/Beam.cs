using System;
using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using UnityEngine;

namespace Assets.Src.Turret
{
    public class Beam
    {
        public Transform RayCaster { get; internal set; }
        public LineRenderer Line { get; internal set; }

        /// <summary>
        /// In Seconds
        /// </summary>
        public float OnTime;

        /// <summary>
        /// In Seconds
        /// </summary>
        public float OffTime;
        public float BeamForce = 0;
        public string FriendlyTeam = null;

        public float RemainingOnTime =0;
        public float RemainingOffTime =0;
        public float BeamDamage = 10;
        public float MaxDistance = 10000;
        public float InitialRadius = 1;
        public float Divergence = 0.0005f;
        
        public float EffectRepeatTime = 0.1f;
        private readonly LampAndParticlesEffectController _hitEffect;

        private bool _isShooting = false;
        private float _hitDistance = 0;

        public Beam(Transform beam, float runTime, float offTime, Color BeamColour, LampAndParticlesEffectController hitEffectPrefab = null)
        {
            RayCaster = beam;
            OnTime = runTime;
            OffTime = offTime;
            RemainingOnTime = OnTime;

            Line = beam.GetComponent<LineRenderer>();
            Line.SetPosition(0, Vector3.zero);
            
            //Debug.Log("beam colour: " + BeamColour);
            beam.SetColor(BeamColour);

            if (hitEffectPrefab != null)
            {
                _hitEffect = GameObject.Instantiate(hitEffectPrefab, RayCaster.position, RayCaster.rotation);
                _hitEffect.transform.parent = RayCaster;
            }
        }

        public void TurnOn()
        {
            //Debug.Log(Transform + ": remainingOffTime: " + RemainingOffTime +
            //    ", remainingOnTime" + RemainingOnTime);
            if (RemainingOffTime <= 0)
            {
                if(RemainingOnTime > 0)
                {
                    //Debug.Log("shooting");
                    //is running
                    FireNow();
                    RemainingOnTime -= Time.fixedDeltaTime;
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
                RemainingOffTime -= Time.fixedDeltaTime;
                RemainingOnTime = OnTime;
            }
        }

        public void Redraw()
        {
            Line.enabled = _isShooting;
            Line.SetPosition(1, Vector3.forward * _hitDistance);
        }

        /// <summary>
        /// Finds if the beam is hitting anything.
        /// </summary>
        /// <returns>The length the laser should be drawn as</returns>
        private void FireNow()
        {
            var ray = new Ray(RayCaster.position, RayCaster.forward);
            if (Physics.Raycast(ray, out RaycastHit hit, MaxDistance, -1, QueryTriggerInteraction.Ignore))
            {
                //is a hit
                if (!string.IsNullOrEmpty(FriendlyTeam) && hit.transform.GetComponent<ITarget>()?.Team == FriendlyTeam)
                {
                    //turn off if aimed at a friend
                    TurnOff();
                    return;
                }
                if (hit.rigidbody != null)
                {
                    hit.rigidbody.AddExplosionForce(ReduceForDistance(BeamForce, hit.distance), hit.point, 10);
                }
                if (_hitEffect != null)
                {
                    //_hitEffect.transform.rotation = hit.normal; //use this to properly orient the effect
                    _hitEffect.transform.position = hit.point;
                    _hitEffect.TurnOn();
                }
                hit.transform.SendMessage("ApplyDamage", ReduceForDistance(BeamDamage, hit.distance), SendMessageOptions.DontRequireReceiver);
                
                _hitDistance = hit.distance;
            } else
            {
                //is a miss
                if (_hitEffect != null)
                {
                    _hitEffect.TurnOff();
                }
                _hitDistance = MaxDistance;
            }
            _isShooting = true;
        }

        private float ReduceForDistance(float baseDamage, float distance)
        {
            var radius = InitialRadius + (Divergence * distance);
            if(radius != 0)
            {
                var reduced = baseDamage * Time.fixedDeltaTime / (radius * radius);
                return reduced;
            }
            Debug.LogWarning("avoided div0 error");
            return baseDamage * Time.fixedDeltaTime;
        }

        public void TurnOff()
        {
            RemainingOffTime -= Time.fixedDeltaTime;
            _isShooting = false;
            if (_hitEffect != null)
            {
                _hitEffect.TurnOff();
            }
        }

        /// <summary>
        /// Forces a reload with the given time required to reload
        /// </summary>
        /// <param name="timeToReload">use null (default) for the normal reload time.</param>
        public void ForceReload(float? timeToReload = null)
        {
            timeToReload = timeToReload != null ? timeToReload : OffTime;
            RemainingOffTime = timeToReload.Value;
            RemainingOnTime = OnTime;
        }
    }
}
