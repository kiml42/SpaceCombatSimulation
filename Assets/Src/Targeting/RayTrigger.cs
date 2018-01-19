using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class RayTrigger : MonoBehaviour, IFireControl
{
    public TargetChoosingMechanism TargetChoosingMechanism;
    public Transform AimingObject;
    public float MaxDistance = 100000;
    public float MinDistance = 0;

    [Tooltip("Shoot anything with an enemy tag, even if it's not the target being aimed at." +
        " Alternatively only shoot if aimed at the actual target.")]
    public bool ShootAnyEnemy = true;

    // Use this for initialization
    void Start()
    {
        TargetChoosingMechanism = TargetChoosingMechanism ?? GetComponent("TargetChoosingMechanism") as TargetChoosingMechanism;
    }

    public bool ShouldShoot(Target target)
    {
        if (AimingObject.IsValid())
        {
            RaycastHit hit;
            var ray = new Ray(AimingObject.position + (AimingObject.forward * MinDistance), AimingObject.forward);
            if (Physics.Raycast(ray, out hit, MaxDistance, -1, QueryTriggerInteraction.Ignore))
            {
                //is a hit
                if (ShootAnyEnemy)
                {
                    var tags = TargetChoosingMechanism.EnemyTags;
                    return tags.Contains(hit.transform.tag);
                }

                return hit.transform == target.Transform;
            }
        } else
        {
            Debug.LogWarning("Aiming object is null");
        }
        return false;
    }

    public bool ShouldShoot()
    {
        if(TargetChoosingMechanism == null)
        {
            Debug.LogWarning(transform + " has null target chosing mechanism");
        }
        return ShouldShoot(TargetChoosingMechanism.CurrentTarget);
    }
}
