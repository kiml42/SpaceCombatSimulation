using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections.Generic;
using UnityEngine;

public class SpawnTurret : MonoBehaviour
{
    public IKnowsEnemyTags EnemyTagSource;

    [Tooltip("if true, the turret will be tagged with the parent objects tag. This object's tag is used if there is no parent.")]
    public bool TagChildren = true;

    [Tooltip("if true, the turret have it's colour set to the colour from the first colour setter in this or its parents.")]
    public bool RecolourChild = true;

    public Transform ParentForTurret;
    
    [Tooltip("only used if the turret won't be able to find a deffered tag source.")]
    public List<string> EnemyTags;

    public Transform TurretPrefab;

	// Use this for initialization
	void Start () {
        if(TurretPrefab != null)
        {
            if(EnemyTagSource == null && transform.parent != null)
            {
                EnemyTagSource = transform.GetComponentInParent<IKnowsEnemyTags>();
            }

            if(EnemyTagSource != null)
            {
                EnemyTags = EnemyTagSource.KnownEnemyTags;
            }

            if (ParentForTurret == null )
            {
                Debug.LogWarning($"{name} has no parent set for its turrets, trying this object's parent");
                ParentForTurret = transform.parent;
            }

            var turret = Instantiate(TurretPrefab, transform.position, transform.rotation, ParentForTurret);

            if(ParentForTurret != null)
            {
                var parentRigidbody = ParentForTurret.GetComponent<Rigidbody>();
                if(parentRigidbody != null)
                {
                    turret.SetVelocity(parentRigidbody.velocity);
                }

                turret.parent = ParentForTurret;
                var turretFixedJoint = turret.GetComponent<FixedJoint>();
                if(turretFixedJoint != null)
                {
                    turret.GetComponent<FixedJoint>().connectedBody = parentRigidbody;
                }
                else
                {
                    Debug.LogWarning($"turret \"{turret}\" does not have a fixed joint to connect to \"{ParentForTurret}\" with.");
                }
            }

            var tagKnower = turret.GetComponent<IKnowsEnemyTags>();
            if(tagKnower != null)
            {
                tagKnower.KnownEnemyTags = EnemyTags;
            }

            if (TagChildren)
            {
                var parentTarget = ParentForTurret.GetComponent<ITarget>();
                turret.GetComponent<ITarget>()?.SetTeamSource(parentTarget ?? GetComponent<ITarget>());
            }

            if (RecolourChild && turret.GetComponent<ColourSetter>() == null && ParentForTurret != null)
            {
                //set the colour on the child, unless it's got its own colour setter, in which case, let that decide.
                var parentColour = ParentForTurret.GetComponentInParent<ColourSetter>();
                if(parentColour != null)
                {
                    turret.SetColor(parentColour.Colour);
                }
            }
        
            Destroy(gameObject);
        } else
        {
            Debug.LogWarning(name + " Has no turret to spawn.");
        }
    }
}
